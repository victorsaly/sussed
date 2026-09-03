import type { ReactElement } from 'react';

/**
 * Structure under the board.
 *
 * A grid of bare numbers on empty paper makes you hunt for which pieces even
 * face each other — that hunting is most of the visual work, and it is what
 * makes a big board feel overwhelming rather than hard. Two faint layers fix
 * it: a lattice so the eye has something to hold, and a lane along every
 * position a piece could still occupy.
 *
 * Lanes dim once they are spent, so the board quietly gets simpler as you
 * solve it. Shared, because every grid game in the studio wants this.
 */

export interface Lane {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** false once this lane is used up or ruled out — it fades back */
  live: boolean;
}

export function Backdrop({
  w,
  h,
  px,
  skip,
  lanes,
}: {
  /** grid width and height in cells */
  w: number;
  h: number;
  /** cell index -> pixel centre */
  px: (i: number) => number;
  /** cells that hold a piece, so no lattice dot is drawn under it */
  skip: ReadonlySet<string>;
  lanes: readonly Lane[];
}) {
  const dots: ReactElement[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (skip.has(`${x},${y}`)) continue;
      dots.push(<circle key={`${x},${y}`} className="s-lattice" cx={px(x)} cy={px(y)} r={1.3} />);
    }
  }
  return (
    <g aria-hidden="true">
      {dots}
      {lanes.map((l, i) => (
        <line
          key={i}
          className={l.live ? 's-lane s-lane-live' : 's-lane'}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
        />
      ))}
    </g>
  );
}
