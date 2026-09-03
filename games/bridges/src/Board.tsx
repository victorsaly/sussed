import { useMemo, useState } from 'react';
import {
  blockedByCrossing,
  degrees,
  type Counts,
  type Puzzle,
  type Topology,
} from './engine';

/**
 * The board. SVG rather than canvas: it gives us real focusable elements,
 * screen-reader labels and CSS theming for nothing, and a 24-island Hashi
 * board is nowhere near the element count where that becomes a problem.
 *
 * Interaction is tap-tap rather than drag. Drag feels natural on a desktop and
 * is miserable on a phone with a thumb — you cannot see what is under your own
 * hand. Tap an island, tap its neighbour, the bridge cycles 0 -> 1 -> 2 -> 0.
 */

const CELL = 46;
const PAD = 26;
const R = 17;

export function Board({
  puzzle,
  topo,
  counts,
  onCycle,
  solved,
  hintEdge,
}: {
  puzzle: Puzzle;
  topo: Topology;
  counts: Counts;
  onCycle: (edgeId: number) => void;
  solved: boolean;
  hintEdge: number | null;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  const width = PAD * 2 + (puzzle.w - 1) * CELL;
  const height = PAD * 2 + (puzzle.h - 1) * CELL;
  const px = (i: number): number => PAD + i * CELL;

  const deg = useMemo(() => degrees(puzzle, topo, counts), [puzzle, topo, counts]);

  /** Islands reachable from the selected one — the only legal next taps. */
  const reachable = useMemo(() => {
    if (selected === null) return new Map<number, number>();
    const m = new Map<number, number>();
    for (const id of topo.incident[selected] ?? []) {
      const e = topo.edges[id]!;
      m.set(e.a === selected ? e.b : e.a, id);
    }
    return m;
  }, [selected, topo]);

  const tapIsland = (i: number): void => {
    if (selected === null) {
      setSelected(i);
      return;
    }
    if (selected === i) {
      setSelected(null);
      return;
    }
    const edgeId = reachable.get(i);
    if (edgeId === undefined) {
      // Not a neighbour — treat it as starting a new selection rather than an
      // error. Punishing a mis-tap on a phone is never the right call.
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
      style={{ width: '100%', height: 'auto', maxHeight: '68dvh', touchAction: 'manipulation' }}
    >
      {/* Bridges under islands so the circles always win visually */}
      {topo.edges.map((e) => {
        const n = counts[e.id] ?? 0;
        const a = puzzle.islands[e.a]!;
        const b = puzzle.islands[e.b]!;
        const isHint = hintEdge === e.id;
        if (n === 0 && !isHint) return null;
        const off = e.horizontal ? [0, 4] : [4, 0];
        const lines = n === 2 ? [-1, 1] : [0];
        return (
          <g key={e.id} className={isHint ? 'hint' : undefined}>
            {lines.map((k, idx) => (
              <line
                key={idx}
                x1={px(a.x) + off[0]! * k}
                y1={px(a.y) + off[1]! * k}
                x2={px(b.x) + off[0]! * k}
                y2={px(b.y) + off[1]! * k}
                className={isHint && n === 0 ? 'bridge bridge-hint' : 'bridge'}
              />
            ))}
          </g>
        );
      })}

      {/* Invisible wide hit areas so a bridge can be tapped directly too */}
      {topo.edges.map((e) => {
        const a = puzzle.islands[e.a]!;
        const b = puzzle.islands[e.b]!;
        const blocked = blockedByCrossing(topo, counts, e.id) && (counts[e.id] ?? 0) === 0;
        if (blocked) return null;
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

      {puzzle.islands.map((is, i) => {
        const done = deg[i] === is.n;
        const over = (deg[i] ?? 0) > is.n;
        const isSelected = selected === i;
        const isTarget = reachable.has(i);
        return (
          <g
            key={i}
            className={[
              'island',
              done ? 'is-done' : '',
              over ? 'is-over' : '',
              isSelected ? 'is-selected' : '',
              isTarget ? 'is-target' : '',
            ]
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

      {solved && (
        <rect x={0} y={0} width={width} height={height} fill="none" className="solved-flash" />
      )}
    </svg>
  );
}
