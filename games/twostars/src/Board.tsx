import { useMemo } from 'react';
import { HintChain, type ChainArrow } from '@sussed/ui';
import type { Deduction, HintFocus } from './solver';
import {
  conflicts,
  DOT,
  implied,
  STAR,
  starCount,
  type Cells,
  type Puzzle,
  type Units,
} from './engine';

/**
 * The board. SVG, like Bridges: real focusable cells, screen-reader labels
 * and CSS theming for nothing.
 *
 * One tap places a star, because that is the move. A second tap turns it
 * into a dot for "not here", a third clears it. Cells ruled out by the stars
 * already placed — next to one, or in a full row, column or region — show a
 * faint dot on their own, so the player is never marking the obvious.
 */

const CELL = 40;
const PAD = 6;

/** Four-tint the regions so neighbours never share a shade. */
function tints(p: Puzzle, u: Units): number[] {
  const n = p.n;
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let i = 0; i < p.regions.length; i++) {
    const r = p.regions[i]!;
    for (const j of [i + 1, i + n]) {
      if (j >= p.regions.length || (j === i + 1 && j % n === 0)) continue;
      const q = p.regions[j]!;
      if (q !== r) {
        adj[r]!.add(q);
        adj[q]!.add(r);
      }
    }
  }
  const order = [...Array(n).keys()].sort((a, b) => u.regions[b]!.length - u.regions[a]!.length);
  const tint = new Array<number>(n).fill(-1);
  for (const r of order) {
    const used = new Set([...adj[r]!].map((q) => tint[q]!));
    let t = 0;
    while (used.has(t)) t++;
    tint[r] = t % 4;
  }
  return tint;
}

function starPath(r: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const rad = k % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * k - Math.PI / 2;
    pts.push(`${(Math.cos(a) * rad).toFixed(2)},${(Math.sin(a) * rad).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}
const STAR_PATH = starPath(11);

export function Board({
  puzzle,
  units,
  cells,
  onCycle,
  solved,
  look,
  target,
  chain,
}: {
  puzzle: Puzzle;
  units: Units;
  cells: Cells;
  onCycle: (cell: number) => void;
  solved: boolean;
  /** the row, column, region or star to pulse — the first rung of the hint ladder */
  look: HintFocus | null;
  /** the cell to highlight — the second rung */
  target: number | null;
  /** the chain — the third rung */
  chain: readonly Deduction[];
}) {
  const n = puzzle.n;
  const size = PAD * 2 + n * CELL;
  const px = (i: number): number => PAD + i * CELL;

  const tint = useMemo(() => tints(puzzle, units), [puzzle, units]);
  const ruledOut = useMemo(() => implied(puzzle, units, cells), [puzzle, units, cells]);
  const bad = useMemo(() => conflicts(puzzle, units, cells).cells, [puzzle, units, cells]);
  /** Pixel centre of whatever a hint points at. */
  const centreOf = (f: HintFocus): [number, number] => {
    const mid = (n * CELL) / 2 + PAD;
    if (f.kind === 'cell') return [px(f.index % n) + CELL / 2, px(Math.floor(f.index / n)) + CELL / 2];
    if (f.kind === 'row') return [mid, px(f.index) + CELL / 2];
    if (f.kind === 'column') return [px(f.index) + CELL / 2, mid];
    if (f.kind === 'rows') return [mid, px(f.index) + ((f.span ?? 1) * CELL) / 2];
    if (f.kind === 'columns') return [px(f.index) + ((f.span ?? 1) * CELL) / 2, mid];
    const cellsIn = units.regions[f.index] ?? [];
    let sx = 0;
    let sy = 0;
    for (const c of cellsIn) {
      sx += px(c % n) + CELL / 2;
      sy += px(Math.floor(c / n)) + CELL / 2;
    }
    return [sx / Math.max(1, cellsIn.length), sy / Math.max(1, cellsIn.length)];
  };

  const arrows: ChainArrow[] = chain.map((d) => {
    const [x1, y1] = centreOf(d.focus);
    const [x2, y2] = centreOf({ kind: 'cell', index: d.cell });
    return { x1, y1, x2, y2, kind: d.value === 'star' ? 'place' : 'rule-out' };
  });

  const lookRegion = look?.kind === 'region' ? look.index : null;
  const lookBand =
    look && (look.kind === 'row' || look.kind === 'rows')
      ? { x: px(0), y: px(look.index), w: n * CELL, h: (look.span ?? 1) * CELL }
      : look && (look.kind === 'column' || look.kind === 'columns')
        ? { x: px(look.index), y: px(0), w: (look.span ?? 1) * CELL, h: n * CELL }
        : null;

  const regionDone = useMemo(
    () => units.regions.map((unit) => starCount(cells, unit) === puzzle.stars),
    [units, cells, puzzle.stars],
  );

  // Region borders: every edge between two cells of different regions.
  const borders = useMemo(() => {
    const segs: string[] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const r = puzzle.regions[i];
        if (x < n - 1 && puzzle.regions[i + 1] !== r) {
          segs.push(`M${px(x + 1)},${px(y)}v${CELL}`);
        }
        if (y < n - 1 && puzzle.regions[i + n] !== r) {
          segs.push(`M${px(x)},${px(y + 1)}h${CELL}`);
        }
      }
    }
    return segs.join('');
  }, [puzzle, n]);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="board"
      role="grid"
      aria-label={`Two Stars puzzle, ${n} by ${n}`}
      style={{ width: '100%', height: 'auto', maxHeight: '68dvh', touchAction: 'manipulation' }}
      onContextMenu={(ev) => ev.preventDefault()}
    >
      {cells.map((mark, i) => {
        const x = i % n;
        const y = Math.floor(i / n);
        const r = puzzle.regions[i]!;
        const isStar = mark === STAR;
        const isDot = mark === DOT;
        const out = ruledOut[i] && !isStar;
        const [row, col] = units.of[i]!;
        const label = isStar
          ? 'star'
          : isDot
            ? 'marked empty'
            : out
              ? 'ruled out'
              : 'empty';
        return (
          <g
            key={i}
            className={[
              'cell',
              `tint-${tint[r]}`,
              regionDone[r] ? 'is-done' : '',
              bad[i] ? 'is-bad' : '',
              target === i ? 'is-hint' : '',
              lookRegion === r ? 'is-look' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            transform={`translate(${px(x)} ${px(y)})`}
            role="gridcell"
            tabIndex={0}
            aria-label={`Row ${row + 1}, column ${col + 1}, ${label}`}
            onPointerDown={(ev) => {
              ev.preventDefault();
              onCycle(i);
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                onCycle(i);
              }
            }}
          >
            <rect className="cell-bg" width={CELL} height={CELL} />
            <rect className="cell-tint" width={CELL} height={CELL} />
            {isStar && <path className="star" d={STAR_PATH} transform={`translate(${CELL / 2} ${CELL / 2})`} />}
            {isDot && <circle className="dot" cx={CELL / 2} cy={CELL / 2} r={3.5} />}
            {!isStar && !isDot && out && <circle className="dot dot-implied" cx={CELL / 2} cy={CELL / 2} r={2.5} />}
          </g>
        );
      })}

      {/* Thin grid, thick region walls, drawn on top so tints never hide them */}
      <g className="grid-lines">
        {[...Array(n + 1).keys()].map((k) => (
          <g key={k}>
            <line x1={px(k)} y1={px(0)} x2={px(k)} y2={px(n)} />
            <line x1={px(0)} y1={px(k)} x2={px(n)} y2={px(k)} />
          </g>
        ))}
      </g>
      <path className="region-walls" d={borders} />
      <rect className="outer-wall" x={px(0)} y={px(0)} width={n * CELL} height={n * CELL} />

      {lookBand && <rect className="s-focus-band" x={lookBand.x} y={lookBand.y} width={lookBand.w} height={lookBand.h} />}
      {look?.kind === 'cell' && (
        <circle className="s-look" cx={px(look.index % n) + CELL / 2} cy={px(Math.floor(look.index / n)) + CELL / 2} r={17} />
      )}

      <HintChain arrows={arrows} />

      {solved && <rect x={0} y={0} width={size} height={size} fill="none" className="solved-flash" />}
    </svg>
  );
}
