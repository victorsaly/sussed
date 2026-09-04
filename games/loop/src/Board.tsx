import { useMemo } from 'react';
import { HintChain, type ChainArrow } from '@sussed/ui';
import type { Deduction, HintFocus } from './solver';
import {
  CROSS,
  implied,
  LINE,
  lineCount,
  network,
  type Marks,
  type Puzzle,
  type Topology,
} from './engine';

/**
 * The board. Dots at the grid corners, clues in the cells, lines between the
 * dots. Each cell is split into four triangles by its diagonals and each
 * triangle is the tap target for the nearest side — so the whole board is
 * tappable with a thumb even though the lines themselves are thin.
 *
 * One tap draws a line, because that is the move. A second tap makes it a
 * cross for "not here", a third clears it. Sides the drawn lines already rule
 * out show a faint cross on their own.
 */

const CELL = 42;
const PAD = 14;

export function Board({
  puzzle,
  topo,
  marks,
  onCycle,
  solved,
  look,
  target,
  chain,
}: {
  puzzle: Puzzle;
  topo: Topology;
  marks: Marks;
  onCycle: (edge: number) => void;
  solved: boolean;
  /** the number, dot or side to pulse — the first rung of the hint ladder */
  look: HintFocus | null;
  /** the side to highlight — the second rung */
  target: number | null;
  /** the chain — the third rung */
  chain: readonly Deduction[];
}) {
  const { w, h } = puzzle;
  const width = PAD * 2 + w * CELL;
  const height = PAD * 2 + h * CELL;
  const px = (i: number): number => PAD + i * CELL;

  const ruledOut = useMemo(() => implied(puzzle, topo, marks), [puzzle, topo, marks]);

  const edgeMid = (id: number): [number, number] => {
    const e = topo.edges[id]!;
    return [px(e.x) + (e.horizontal ? CELL / 2 : 0), px(e.y) + (e.horizontal ? 0 : CELL / 2)];
  };
  const centreOf = (f: HintFocus): [number, number] => {
    if (f.kind === 'cell') return [px(f.index % w) + CELL / 2, px(Math.floor(f.index / w)) + CELL / 2];
    if (f.kind === 'dot') return [px(f.index % (w + 1)), px(Math.floor(f.index / (w + 1)))];
    return edgeMid(f.index);
  };
  const arrows: ChainArrow[] = chain.map((d) => {
    const [x1, y1] = centreOf(d.focus);
    const [x2, y2] = edgeMid(d.edge);
    return { x1, y1, x2, y2, kind: d.value === 'line' ? 'place' : 'rule-out' };
  });
  const lookAt = look ? centreOf(look) : null;
  const net = useMemo(() => network(puzzle, topo, marks), [puzzle, topo, marks]);
  const forks = useMemo(() => new Set(net.forks), [net]);
  const overfull = useMemo(
    () => new Set(topo.clued.filter((c) => lineCount(marks, topo.cellEdges[c]!) > puzzle.clues[c]!)),
    [topo, marks, puzzle],
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="board"
      role="group"
      aria-label={`Loop puzzle, ${w} by ${h}`}
      style={{ width: '100%', height: 'auto', maxHeight: '68dvh', touchAction: 'manipulation' }}
      onContextMenu={(ev) => ev.preventDefault()}
    >
      {/* Clues */}
      {topo.clued.map((c) => {
        const x = c % w;
        const y = Math.floor(c / w);
        const met = lineCount(marks, topo.cellEdges[c]!) === puzzle.clues[c];
        return (
          <text
            key={`clue-${c}`}
            className={['clue', met ? 'is-met' : '', overfull.has(c) ? 'is-over' : ''].filter(Boolean).join(' ')}
            x={px(x) + CELL / 2}
            y={px(y) + CELL / 2}
            textAnchor="middle"
            dominantBaseline="central"
            dy="1"
          >
            {puzzle.clues[c]}
          </text>
        );
      })}

      {/* Lines and crosses */}
      {topo.edges.map((e) => {
        const m = marks[e.id];
        const x1 = px(e.x);
        const y1 = px(e.y);
        const x2 = e.horizontal ? px(e.x + 1) : x1;
        const y2 = e.horizontal ? y1 : px(e.y + 1);
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const isHint = target === e.id || (look?.kind === 'edge' && look.index === e.id);
        const bad = m === LINE && (forks.has(e.a) || forks.has(e.b));
        if (m === LINE) {
          return (
            <line
              key={e.id}
              className={['line', bad ? 'is-bad' : '', solved ? 'is-solved' : ''].filter(Boolean).join(' ')}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
            />
          );
        }
        if (m === CROSS || ruledOut[e.id] || isHint) {
          const cls = isHint ? 'cross is-hint' : m === CROSS ? 'cross' : 'cross cross-implied';
          const r = 3;
          return (
            <g key={e.id} className={cls}>
              {isHint ? (
                <line className="line line-hint" x1={x1} y1={y1} x2={x2} y2={y2} />
              ) : (
                <>
                  <line x1={mx - r} y1={my - r} x2={mx + r} y2={my + r} />
                  <line x1={mx - r} y1={my + r} x2={mx + r} y2={my - r} />
                </>
              )}
            </g>
          );
        }
        return null;
      })}

      {/* Dots */}
      {Array.from({ length: (w + 1) * (h + 1) }, (_, v) => {
        const x = v % (w + 1);
        const y = Math.floor(v / (w + 1));
        return <circle key={`dot-${v}`} className={forks.has(v) ? 'dot is-bad' : 'dot'} cx={px(x)} cy={px(y)} r={2.6} />;
      })}

      {/* Tap targets: four triangles per cell, one per side, plus the outer sides */}
      {Array.from({ length: w * h }, (_, c) => {
        const x = c % w;
        const y = Math.floor(c / w);
        const [top, right, bottom, left] = topo.cellEdges[c]!;
        const X = px(x);
        const Y = px(y);
        const cx = X + CELL / 2;
        const cy = Y + CELL / 2;
        const tri = (edge: number, pts: string): JSX.Element => (
          <polygon
            key={`hit-${c}-${edge}`}
            className="hit"
            points={pts}
            onPointerDown={(ev) => {
              ev.preventDefault();
              onCycle(edge);
            }}
          />
        );
        return (
          <g key={`hits-${c}`}>
            {tri(top!, `${X},${Y} ${X + CELL},${Y} ${cx},${cy}`)}
            {tri(right!, `${X + CELL},${Y} ${X + CELL},${Y + CELL} ${cx},${cy}`)}
            {tri(bottom!, `${X},${Y + CELL} ${X + CELL},${Y + CELL} ${cx},${cy}`)}
            {tri(left!, `${X},${Y} ${X},${Y + CELL} ${cx},${cy}`)}
          </g>
        );
      })}
      {/* A strip outside the outer edges so border sides are easy to reach */}
      {topo.edges
        .filter((e) => topo.edgeCells[e.id]!.length === 1)
        .map((e) => {
          const x1 = px(e.x);
          const y1 = px(e.y);
          const out = e.horizontal ? (e.y === 0 ? -PAD : PAD) : e.x === 0 ? -PAD : PAD;
          const pts = e.horizontal
            ? `${x1},${y1} ${x1 + CELL},${y1} ${x1 + CELL},${y1 + out} ${x1},${y1 + out}`
            : `${x1},${y1} ${x1},${y1 + CELL} ${x1 + out},${y1 + CELL} ${x1 + out},${y1}`;
          return (
            <polygon
              key={`rim-${e.id}`}
              className="hit"
              points={pts}
              onPointerDown={(ev) => {
                ev.preventDefault();
                onCycle(e.id);
              }}
            />
          );
        })}

      {lookAt && look?.kind !== 'edge' && <circle className="s-look" cx={lookAt[0]} cy={lookAt[1]} r={17} />}
      <HintChain arrows={arrows} />

      {solved && <rect x={0} y={0} width={width} height={height} fill="none" className="solved-flash" />}
    </svg>
  );
}
