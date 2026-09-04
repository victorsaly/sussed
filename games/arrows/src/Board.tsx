/**
 * The board.
 *
 * One SVG, one stroke per path. The threading is done with `stroke-dasharray`
 * rather than by redrawing cells: a window the length of the body slides along
 * the full route, so the body genuinely follows the head around its own
 * corners. That is the animation the whole game rests on — it explains the rule
 * while the player watches, which is why this game needs no tutorial.
 *
 * Two details carried over from the prototype, both of which were bugs first:
 *
 *   The arrowhead takes its angle from `dir` at rest and from the drawn tangent
 *   only while moving. Using the tangent at rest makes a head point along its
 *   last body segment, which is the direction it CAME from on a curled path —
 *   an arrow that points left and then leaves upward.
 *
 *   The tap target is a second, fat, transparent copy of the same route. A
 *   13px stroke is not something a thumb can hit; a 70px one is.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import {
  DX,
  DY,
  cellX,
  cellY,
  headCell,
  type PathDef,
  type Puzzle,
  type State,
} from './engine';

const CELL = 100;
const PAD = 60;

/**
 * The head is loud and the tail is quiet, and that is the rule drawn rather
 * than written.
 *
 * The first version gave both the same ink and made the head only twice the
 * body's width. On a three-path teaching board that reads fine; at eight paths
 * and 82% density it does not — you have to hunt for the arrowheads, and the
 * arrowhead is the ONLY thing that decides whether a path can go. A player
 * scanning for heads and finding tails is a player being asked to do the wrong
 * work.
 *
 * So the tail is thinner and paler than the head, in proportion to how much it
 * matters: none at all.
 */
const BODY_WIDTH = 11;
const HEAD_SIZE = 40;
/** How far the tip sits ahead of the head cell, as a share of HEAD_SIZE. */
const HEAD_TIP = 0.75;

/** Exit takes a moment longer for a longer path, so all bodies move at one speed. */
const exitMs = (path: PathDef): number => 360 + path.cells.length * 45;

function routeD(p: Puzzle, path: PathDef): string {
  const pts = path.cells.map((c) => [PAD + cellX(p, c) * CELL, PAD + cellY(p, c) * CELL]);
  let x = cellX(p, headCell(path));
  let y = cellY(p, headCell(path));
  // Carry the route past the edge, so the head has somewhere to go.
  for (let k = 0; k < Math.max(p.w, p.h) + 2; k++) {
    x += DX[path.dir] as number;
    y += DY[path.dir] as number;
    pts.push([PAD + x * CELL, PAD + y * CELL]);
  }
  return `M${pts.map((q) => `${q[0]} ${q[1]}`).join('L')}`;
}

function headPoints(cx: number, cy: number, angle: number): string {
  const s = HEAD_SIZE;
  return (
    `${cx + Math.cos(angle) * s * HEAD_TIP},${cy + Math.sin(angle) * s * HEAD_TIP} ` +
    `${cx + Math.cos(angle + 2.5) * s},${cy + Math.sin(angle + 2.5) * s} ` +
    `${cx + Math.cos(angle - 2.5) * s},${cy + Math.sin(angle - 2.5) * s}`
  );
}

export interface BoardProps {
  puzzle: Puzzle;
  state: State;
  /** a path that has left the state but is still animating its way out */
  exiting: number | null;
  onExitDone: () => void;
  onTap: (index: number) => void;
  /** the path the hint ladder is pointing at */
  look: number | null;
  /** the order the ladder is showing, drawn as numbered badges */
  chain: number[];
  /** a path just tapped that could not go — shakes, then clears */
  miss: number | null;
}

export function Board({
  puzzle,
  state,
  exiting,
  onExitDone,
  onTap,
  look,
  chain,
  miss,
}: BoardProps) {
  const bodies = useRef(new Map<number, SVGPathElement>());
  const heads = useRef(new Map<number, SVGPolygonElement>());
  const frame = useRef(0);

  const width = PAD * 2 + (puzzle.w - 1) * CELL;
  const height = PAD * 2 + (puzzle.h - 1) * CELL;

  /**
   * Put a path's visible window at `offset` along its route, and its head at
   * the leading end. At offset 0 this is the resting position, which is why the
   * same function draws both the static board and every frame of the animation.
   */
  const place = useCallback(
    (index: number, offset: number) => {
      const path = puzzle.paths[index];
      const body = bodies.current.get(index);
      const head = heads.current.get(index);
      if (!path || !body || !head) return;

      const total = body.getTotalLength();
      const bodyLen = (path.cells.length - 1) * CELL;
      body.setAttribute('stroke-dasharray', `${bodyLen} ${total + bodyLen}`);
      body.setAttribute('stroke-dashoffset', String(-offset));

      const at = Math.min(offset + bodyLen, total);
      const tip = body.getPointAtLength(at);
      const behind = body.getPointAtLength(Math.max(0, at - 1));
      const angle =
        offset === 0
          ? Math.atan2(DY[path.dir] as number, DX[path.dir] as number)
          : Math.atan2(tip.y - behind.y, tip.x - behind.x);
      head.setAttribute('points', headPoints(tip.x, tip.y, angle));
    },
    [puzzle],
  );

  // Draw every path at rest whenever the board changes. getTotalLength needs the
  // element laid out, so this is a layout effect rather than a render.
  useLayoutEffect(() => {
    puzzle.paths.forEach((_, i) => place(i, 0));
  }, [puzzle, place]);

  // Thread one path out, then tell the caller so it can move on.
  useEffect(() => {
    if (exiting === null) return;
    const path = puzzle.paths[exiting];
    const body = bodies.current.get(exiting);
    if (!path || !body) {
      onExitDone();
      return;
    }

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced) {
      onExitDone();
      return;
    }

    const total = body.getTotalLength();
    const duration = exitMs(path);
    const started = performance.now();

    const step = (now: number): void => {
      const t = Math.min(1, (now - started) / duration);
      // Smoothstep, so it threads rather than jerks.
      place(exiting, total * (t < 1 ? t * t * (3 - 2 * t) : 1));
      if (t < 1) frame.current = requestAnimationFrame(step);
      else onExitDone();
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [exiting, puzzle, place, onExitDone]);

  const order = new Map(chain.map((index, i) => [index, i + 1]));

  return (
    <svg
      className="maze"
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label={`${puzzle.w} by ${puzzle.h} board, ${state.live.filter(Boolean).length} paths left`}
    >
      {Array.from({ length: puzzle.h }, (_, y) =>
        Array.from({ length: puzzle.w }, (_, x) => (
          <circle
            key={`d${x}-${y}`}
            className="grid-dot"
            cx={PAD + x * CELL}
            cy={PAD + y * CELL}
            r={5}
          />
        )),
      )}

      {puzzle.paths.map((path, i) => {
        if (!state.live[i] && exiting !== i) return null;
        const d = routeD(puzzle, path);
        const badge = order.get(i);
        const classes = [
          'path',
          look === i ? 'is-look' : '',
          miss === i ? 'is-miss' : '',
          badge ? 'is-chain' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <g key={i} className={classes}>
            <path
              ref={(el) => {
                if (el) bodies.current.set(i, el);
                else bodies.current.delete(i);
              }}
              className="path-body"
              d={d}
              strokeWidth={BODY_WIDTH}
            />
            <polygon
              ref={(el) => {
                if (el) heads.current.set(i, el);
                else heads.current.delete(i);
              }}
              className="path-head"
              points="0,0 0,0 0,0"
            />
            {badge !== undefined && (
              <text
                className="path-badge"
                x={PAD + cellX(puzzle, headCell(path)) * CELL}
                y={PAD + cellY(puzzle, headCell(path)) * CELL - 34}
              >
                {badge}
              </text>
            )}
            <path
              className="path-hit"
              d={d}
              strokeWidth={CELL * 0.7}
              onPointerDown={(e) => {
                e.preventDefault();
                onTap(i);
              }}
            />
          </g>
        );
      })}
    </svg>
  );
}
