/**
 * The third rung of the hint ladder, drawn.
 *
 * Numbered arrows for the next few forced moves, animating in sequence, each
 * pointing away from the thing that forces it. The point is to show the
 * reasoning travelling across the board — and then to leave the player to
 * actually make the moves.
 *
 * Geometry in, arrows out. Knows nothing about any particular game.
 */

export interface ChainArrow {
  /** from the piece that forces the move, towards the piece it acts on */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'place' | 'rule-out';
  /** small badge such as "x2" */
  label?: string;
}

const GAP = 22;
const HEAD = 11;

export function HintChain({ arrows }: { arrows: readonly ChainArrow[] }) {
  return (
    <g aria-hidden="true">
      {arrows.map((a, i) => {
        const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
        // Stop short of both ends so the arrow sits beside the pieces, not on them.
        const sx = a.x1 + Math.cos(ang) * GAP;
        const sy = a.y1 + Math.sin(ang) * GAP;
        const gx = a.x2 - Math.cos(ang) * GAP;
        const gy = a.y2 - Math.sin(ang) * GAP;
        const len = Math.hypot(gx - sx, gy - sy);
        const mx = (sx + gx) / 2;
        const my = (sy + gy) / 2;
        const delay = `${(i * 0.28).toFixed(2)}s`;

        return (
          <g key={i} className="s-chain" style={{ animationDelay: delay }}>
            {a.kind === 'rule-out' ? (
              <g className="s-chain-x">
                <line x1={mx - 7} y1={my - 7} x2={mx + 7} y2={my + 7} />
                <line x1={mx + 7} y1={my - 7} x2={mx - 7} y2={my + 7} />
              </g>
            ) : (
              <>
                <line
                  className="s-chain-line"
                  style={{
                    ['--len' as string]: len.toFixed(1),
                    strokeDasharray: len.toFixed(1),
                    animationDelay: delay,
                  }}
                  x1={sx}
                  y1={sy}
                  x2={gx}
                  y2={gy}
                />
                <polygon
                  className="s-chain-head"
                  points={[
                    `${gx},${gy}`,
                    `${gx - Math.cos(ang - 0.4) * HEAD},${gy - Math.sin(ang - 0.4) * HEAD}`,
                    `${gx - Math.cos(ang + 0.4) * HEAD},${gy - Math.sin(ang + 0.4) * HEAD}`,
                  ].join(' ')}
                />
              </>
            )}
            {a.label && (
              <text className="s-chain-label" x={mx + 11} y={my - 8}>
                {a.label}
              </text>
            )}
            <circle className="s-chain-badge" cx={mx - 13} cy={my - 11} r={8} />
            <text
              className="s-chain-num"
              x={mx - 13}
              y={my - 11}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {i + 1}
            </text>
          </g>
        );
      })}
    </g>
  );
}
