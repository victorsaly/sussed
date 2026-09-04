/**
 * The board.
 *
 * One SVG, one stroke per path. The threading is done with `stroke-dasharray`
 * rather than by redrawing cells: a window the length of the body slides along
 * the full route, so the body genuinely follows the head around its own
 * corners. That animation explains the rule while the player watches, which is
 * why this game needs no tutorial.
 *
 * Everything here is computed during render, including the resting dash window
 * and every arrowhead. The first version set those imperatively in a layout
 * effect, and the failure mode was ugly enough to be worth recording: if the
 * effect did not fire, every path drew its FULL route — including the run that
 * carries on past the edge of the board — and every arrowhead sat collapsed at
 * the origin, invisible. A board that is only correct one effect after paint is
 * the wrong shape for a game whose whole promise is that you arrive already
 * playing. So the geometry is pure, the route length is arithmetic rather than
 * `getTotalLength()`, and the very first paint is right.
 *
 * One detail carried over from the prototype, which was a bug first: an
 * arrowhead takes its angle from `dir` at rest and from its travelling segment
 * only while moving. Using the drawn tangent at rest points the head back along
 * the last body segment — the direction it came FROM on a curled path — which
 * is an arrow that points left and then leaves upward.
 */

import { useEffect, useRef, useState } from 'react';
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
 * scanning for heads and finding tails is being asked to do the wrong work.
 */
const BODY_WIDTH = 11;
const HEAD_SIZE = 40;
/** How far the tip sits ahead of the head cell, as a share of HEAD_SIZE. */
const HEAD_TIP = 0.75;

type Point = { x: number; y: number };

/** Exit takes a moment longer for a longer path, so all bodies move at one speed. */
const exitMs = (path: PathDef): number => 360 + path.cells.length * 45;

/** How far the route runs on past the edge — far enough for any board. */
const runOff = (p: Puzzle): number => (Math.max(p.w, p.h) + 2) * CELL;

/**
 * The route: the body's cells, then straight on past the edge so the head has
 * somewhere to go. Every segment is axis-aligned and exactly CELL long, which
 * is what lets the lengths below be arithmetic instead of measurement.
 */
function routePoints(p: Puzzle, path: PathDef): Point[] {
  const pts: Point[] = path.cells.map((c) => ({
    x: PAD + cellX(p, c) * CELL,
    y: PAD + cellY(p, c) * CELL,
  }));
  let x = cellX(p, headCell(path));
  let y = cellY(p, headCell(path));
  const steps = runOff(p) / CELL;
  for (let k = 0; k < steps; k++) {
    x += DX[path.dir] as number;
    y += DY[path.dir] as number;
    pts.push({ x: PAD + x * CELL, y: PAD + y * CELL });
  }
  return pts;
}

const toD = (pts: Point[]): string => `M${pts.map((q) => `${q.x} ${q.y}`).join('L')}`;

/** Where the leading end sits at `dist` along the route, and which way it points. */
function alongRoute(pts: Point[], dist: number): { at: Point; angle: number } {
  let left = Math.max(0, dist);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (len === 0) continue;
    if (left <= len) {
      const t = left / len;
      return {
        at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }
    left -= len;
  }
  const last = pts[pts.length - 1] as Point;
  const prev = pts[pts.length - 2] ?? last;
  return { at: last, angle: Math.atan2(last.y - prev.y, last.x - prev.x) };
}

function headPoints(at: Point, angle: number): string {
  const s = HEAD_SIZE;
  return (
    `${at.x + Math.cos(angle) * s * HEAD_TIP},${at.y + Math.sin(angle) * s * HEAD_TIP} ` +
    `${at.x + Math.cos(angle + 2.5) * s},${at.y + Math.sin(angle + 2.5) * s} ` +
    `${at.x + Math.cos(angle - 2.5) * s},${at.y + Math.sin(angle - 2.5) * s}`
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
  /**
   * Draw the whole board faded and untappable, however much of it has left.
   *
   * This is what a finished Arrows board looks like. Clearing it empties it, so
   * the honest picture of a win is a grid of nothing — which tells the player
   * neither that they finished nor what they finished. Redrawing the opening
   * position, greyed, gives the solve something to have been about.
   */
  ghost?: boolean;
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
  ghost = false,
}: BoardProps) {
  // How far the leaving path has threaded, in route units. Kept in state so the
  // drawing stays a function of the data even mid-animation.
  const [travelled, setTravelled] = useState(0);
  const frame = useRef(0);
  const done = useRef(onExitDone);
  done.current = onExitDone;

  useEffect(() => {
    if (exiting === null) {
      setTravelled(0);
      return;
    }
    const path = puzzle.paths[exiting];
    if (!path) {
      done.current();
      return;
    }

    const total = (path.cells.length - 1) * CELL + runOff(puzzle);
    const reduced =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    if (reduced) {
      done.current();
      return;
    }

    const duration = exitMs(path);
    const started = performance.now();
    let finished = false;
    const settle = (): void => {
      if (finished) return;
      finished = true;
      done.current();
    };

    const step = (now: number): void => {
      const t = Math.min(1, (now - started) / duration);
      // Smoothstep, so it threads rather than jerks.
      setTravelled(total * t * t * (3 - 2 * t));
      if (t < 1) frame.current = requestAnimationFrame(step);
      else settle();
    };
    frame.current = requestAnimationFrame(step);

    /* The backstop, and it is not paranoia.
     *
     * Taps are refused while a path is on its way out, and the only thing that
     * lifts that is this animation finishing. requestAnimationFrame does not
     * run in a backgrounded tab — so switching away mid-exit and coming back
     * would leave the board permanently untappable, with nothing on screen to
     * say why. A timer that cannot be starved ends the move regardless; if the
     * frames never came, nobody was watching the animation anyway. */
    const backstop = setTimeout(settle, duration + 500);

    return () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(backstop);
    };
  }, [exiting, puzzle]);

  const width = PAD * 2 + (puzzle.w - 1) * CELL;
  const height = PAD * 2 + (puzzle.h - 1) * CELL;
  const order = new Map(chain.map((index, i) => [index, i + 1]));
  const live = state.live.filter(Boolean).length;
  const label = ghost
    ? `${puzzle.w} by ${puzzle.h} board, cleared`
    : `${puzzle.w} by ${puzzle.h} board, ${live} path${live === 1 ? '' : 's'} left`;

  return (
    <svg
      className="maze"
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label={label}
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
        if (!ghost && !state.live[i] && exiting !== i) return null;

        const pts = routePoints(puzzle, path);
        const d = toD(pts);
        const bodyLen = (path.cells.length - 1) * CELL;
        const total = bodyLen + runOff(puzzle);
        const offset = exiting === i ? travelled : 0;

        // The visible window is the body's length, slid along the whole route.
        const dash = `${bodyLen} ${total + bodyLen}`;

        const tip =
          offset === 0
            ? {
                at: { x: PAD + cellX(puzzle, headCell(path)) * CELL, y: PAD + cellY(puzzle, headCell(path)) * CELL },
                angle: Math.atan2(DY[path.dir] as number, DX[path.dir] as number),
              }
            : alongRoute(pts, offset + bodyLen);

        const badge = order.get(i);
        const classes = [
          'path',
          ghost ? 'is-ghost' : '',
          look === i ? 'is-look' : '',
          miss === i ? 'is-miss' : '',
          badge ? 'is-chain' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <g key={i} className={classes}>
            <path
              className="path-body"
              d={d}
              strokeWidth={BODY_WIDTH}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
            <polygon className="path-head" points={headPoints(tip.at, tip.angle)} />
            {badge !== undefined && (
              <text
                className="path-badge"
                x={PAD + cellX(puzzle, headCell(path)) * CELL}
                y={PAD + cellY(puzzle, headCell(path)) * CELL - 34}
              >
                {badge}
              </text>
            )}
            {/* A fat invisible copy of the route. The visible stroke is 11 units
                wide; a thumb needs about 70. */}
            {!ghost && (
              <path
                className="path-hit"
                d={d}
                strokeWidth={CELL * 0.7}
                onPointerDown={(e) => {
                  e.preventDefault();
                  onTap(i);
                }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
