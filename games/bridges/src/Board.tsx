import { useMemo, useState } from 'react';
import { Backdrop, HintChain, type ChainArrow, type Lane } from '@sussed/ui';
import {
  blockedByCrossing,
  degrees,
  type BoardState,
  type Puzzle,
  type Topology,
} from './engine';
import type { Deduction } from './solver';

/**
 * The board. SVG rather than canvas: real focusable elements, screen-reader
 * labels and CSS theming for free, and a 24-island Hashi board is nowhere near
 * the element count where that becomes a problem.
 *
 * Interaction is tap-tap rather than drag. Drag feels natural on a desktop and
 * is miserable on a phone with a thumb — you cannot see what is under your own
 * hand. Tap an island, tap its neighbour; the bridge cycles one, two, ✗, clear.
 */

const CELL = 46;
const PAD = 26;
const R = 17;

export function Board({
  puzzle,
  topo,
  state,
  onCycle,
  solved,
  look,
  target,
  chain,
}: {
  puzzle: Puzzle;
  topo: Topology;
  state: BoardState;
  onCycle: (edgeId: number) => void;
  solved: boolean;
  /** island to pulse — the first rung of the hint ladder */
  look: number | null;
  /** edge to highlight — the second rung */
  target: number | null;
  /** the chain — the third rung */
  chain: readonly Deduction[];
}) {
  const [selected, setSelected] = useState<number | null>(null);

  const width = PAD * 2 + (puzzle.w - 1) * CELL;
  const height = PAD * 2 + (puzzle.h - 1) * CELL;
  const px = (i: number): number => PAD + i * CELL;

  const deg = useMemo(() => degrees(puzzle, topo, state.counts), [puzzle, topo, state.counts]);

  const reachable = useMemo(() => {
    if (selected === null) return new Map<number, number>();
    const m = new Map<number, number>();
    for (const id of topo.incident[selected] ?? []) {
      const e = topo.edges[id]!;
      m.set(e.a === selected ? e.b : e.a, id);
    }
    return m;
  }, [selected, topo]);

  const lanes: Lane[] = topo.edges.map((e) => {
    const a = puzzle.islands[e.a]!;
    const b = puzzle.islands[e.b]!;
    const spent =
      (state.counts[e.id] ?? 0) > 0 ||
      state.marks.has(e.id) ||
      blockedByCrossing(topo, state.counts, e.id);
    return { x1: px(a.x), y1: px(a.y), x2: px(b.x), y2: px(b.y), live: !spent };
  });

  const arrows: ChainArrow[] = chain.map((d) => {
    const e = topo.edges[d.edgeId]!;
    const from = puzzle.islands[d.island]!;
    const to = puzzle.islands[d.island === e.a ? e.b : e.a]!;
    return {
      x1: px(from.x),
      y1: px(from.y),
      x2: px(to.x),
      y2: px(to.y),
      kind: d.value === 0 ? 'rule-out' : 'place',
      label: d.value === 2 ? '×2' : undefined,
    };
  });

  const occupied = new Set(puzzle.islands.map((i) => `${i.x},${i.y}`));

  const tapIsland = (i: number): void => {
    if (selected === null || selected === i) {
      setSelected(selected === i ? null : i);
      return;
    }
    const edgeId = reachable.get(i);
    // A mis-tap starts a new selection rather than erroring. Punishing a
    // fat finger on a phone is never the right call.
    if (edgeId === undefined) {
      setSelected(i);
      return;
    }
    onCycle(edgeId);
    setSelected(null);
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="board"
      role="group"
      aria-label={`Bridges puzzle, ${puzzle.islands.length} islands`}
      style={{ width: '100%', height: 'auto', maxHeight: '56dvh', touchAction: 'manipulation' }}
    >
      <Backdrop w={puzzle.w} h={puzzle.h} px={px} skip={occupied} lanes={lanes} />

      {topo.edges.map((e) => {
        const n = state.counts[e.id] ?? 0;
        const a = puzzle.islands[e.a]!;
        const b = puzzle.islands[e.b]!;
        const mx = (px(a.x) + px(b.x)) / 2;
        const my = (px(a.y) + px(b.y)) / 2;
        const isTarget = target === e.id;

        if (n > 0) {
          const off = e.horizontal ? [0, 4] : [4, 0];
          return (
            <g key={e.id}>
              {(n === 2 ? [-1, 1] : [0]).map((k, idx) => (
                <line
                  key={idx}
                  x1={px(a.x) + off[0]! * k}
                  y1={px(a.y) + off[1]! * k}
                  x2={px(b.x) + off[0]! * k}
                  y2={px(b.y) + off[1]! * k}
                  className="bridge"
                />
              ))}
            </g>
          );
        }
        if (state.marks.has(e.id)) {
          return (
            <g key={e.id} className="s-mark">
              <line x1={mx - 6} y1={my - 6} x2={mx + 6} y2={my + 6} />
              <line x1={mx + 6} y1={my - 6} x2={mx - 6} y2={my + 6} />
            </g>
          );
        }
        if (blockedByCrossing(topo, state.counts, e.id)) {
          // Drawn by the game, not the player. This is how the ✗ gets taught.
          return (
            <g key={e.id} className="s-mark-auto">
              <line x1={mx - 5} y1={my - 5} x2={mx + 5} y2={my + 5} />
              <line x1={mx + 5} y1={my - 5} x2={mx - 5} y2={my + 5} />
            </g>
          );
        }
        if (isTarget) {
          return (
            <line
              key={e.id}
              x1={px(a.x)}
              y1={px(a.y)}
              x2={px(b.x)}
              y2={px(b.y)}
              className="bridge bridge-hint"
            />
          );
        }
        return null;
      })}

      <HintChain arrows={arrows} />

      {topo.edges.map((e) => {
        if (blockedByCrossing(topo, state.counts, e.id) && (state.counts[e.id] ?? 0) === 0) {
          return null;
        }
        const a = puzzle.islands[e.a]!;
        const b = puzzle.islands[e.b]!;
        return (
          <line
            key={`hit-${e.id}`}
            x1={px(a.x)}
            y1={px(a.y)}
            x2={px(b.x)}
            y2={px(b.y)}
            stroke="transparent"
            strokeWidth={22}
            style={{ cursor: 'pointer' }}
            onPointerDown={(ev) => {
              ev.preventDefault();
              setSelected(null);
              onCycle(e.id);
            }}
          />
        );
      })}

      {look !== null && (
        <circle className="s-look" cx={px(puzzle.islands[look]!.x)} cy={px(puzzle.islands[look]!.y)} r={R} />
      )}

      {puzzle.islands.map((is, i) => {
        const done = deg[i] === is.n;
        const over = (deg[i] ?? 0) > is.n;
        return (
          <g
            key={i}
            className={['island', done ? 'is-done' : '', over ? 'is-over' : '',
              selected === i ? 'is-selected' : '', reachable.has(i) ? 'is-target' : '']
              .filter(Boolean)
              .join(' ')}
            transform={`translate(${px(is.x)} ${px(is.y)})`}
            role="button"
            tabIndex={0}
            aria-label={`Island needing ${is.n} bridges, currently ${deg[i]}`}
            onPointerDown={(ev) => {
              ev.preventDefault();
              tapIsland(i);
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                tapIsland(i);
              }
            }}
          >
            <circle r={R} />
            <text textAnchor="middle" dominantBaseline="central" dy="0.5">
              {is.n}
            </text>
          </g>
        );
      })}

      {solved && <rect x={0} y={0} width={width} height={height} className="solved-flash" />}
    </svg>
  );
}
