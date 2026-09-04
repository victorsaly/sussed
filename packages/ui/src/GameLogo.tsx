/**
 * One mark per game, all drawn in the same hand: faint rules, ink strokes,
 * one accent element that is the game's mechanic. Colours come from the
 * theme — ink is currentColor, the accent is var(--s-accent) — so a logo
 * picks up its game's hue from identity.css and both themes for free.
 *
 * Everything is geometry, no <text>, so a mark survives any size from a
 * 16px favicon sketch to a hub card. Keep it that way.
 */

export type GameId =
  | 'slitherlink'
  | 'bridges'
  | 'starbattle'
  | 'pushpar'
  | 'lastpiece'
  | 'shikaku'
  | 'rewind'
  | 'telegraph'
  | 'shadowplay';

export const GAME_IDS: GameId[] = [
  'slitherlink',
  'bridges',
  'starbattle',
  'pushpar',
  'lastpiece',
  'shikaku',
  'rewind',
  'telegraph',
  'shadowplay',
];

const RULE = 'var(--s-rule)';
const ACCENT = 'var(--s-accent)';

/** Five-point star path, point up. */
function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const radius = k % 2 === 0 ? r : r * 0.42;
    const angle = (-90 + k * 36) * (Math.PI / 180);
    pts.push(`${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/* Each mark is a 48x48 drawing. Ink strokes inherit currentColor. */
const MARKS: Record<GameId, React.ReactNode> = {
  // The loop: a dot lattice with one closed circuit drawn through it.
  slitherlink: (
    <>
      <path
        d="M8 8H24V24H40V40H8Z"
        fill="none"
        stroke={ACCENT}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      {[8, 24, 40].flatMap((y) =>
        [8, 24, 40].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={2.2} fill="currentColor" />),
      )}
    </>
  ),

  // Four islands, one double bridge — the tap that makes the game.
  bridges: (
    <>
      <g stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round">
        <path d="M17 10H31M17 38H31M38 17V31" />
        <path d="M8 17V31M12 17V31" />
      </g>
      {[
        [10, 10],
        [38, 10],
        [10, 38],
        [38, 38],
      ].map(([x, y]) => (
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          r={6.5}
          fill={ACCENT}
          fillOpacity={0.15}
          stroke="currentColor"
          strokeWidth={2}
        />
      ))}
    </>
  ),

  // Two stars on a quartered grid, never touching; dots are eliminations.
  starbattle: (
    <>
      <g stroke={RULE} strokeWidth={2} fill="none">
        <rect x={6} y={6} width={36} height={36} />
        <path d="M24 6V42M6 24H42" />
      </g>
      <path d={star(15, 15, 7)} fill={ACCENT} />
      <path d={star(33, 33, 7)} fill={ACCENT} />
      <circle cx={33} cy={15} r={1.8} fill="currentColor" />
      <circle cx={15} cy={33} r={1.8} fill="currentColor" />
    </>
  ),

  // A crate, a push, a target. Par is the number you feel, not draw.
  pushpar: (
    <>
      <rect x={6} y={6} width={36} height={36} fill="none" stroke={RULE} strokeWidth={2} />
      <rect
        x={30}
        y={18}
        width={12}
        height={12}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeDasharray="3 3"
      />
      <rect x={10} y={18} width={12} height={12} rx={1.5} fill={ACCENT} />
      <path d="M23 24h4" stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round" />
      <path d="M33 24l-5-3v6Z" fill={ACCENT} />
    </>
  ),

  // One piece takes another; the checkerboard is only suggested.
  lastpiece: (
    <>
      <rect x={6} y={6} width={18} height={18} fill="currentColor" opacity={0.12} />
      <rect x={24} y={24} width={18} height={18} fill="currentColor" opacity={0.12} />
      <path
        d="M20 20L28 28"
        stroke={ACCENT}
        strokeWidth={2.2}
        strokeDasharray="3 3"
        strokeLinecap="round"
      />
      <circle cx={15} cy={15} r={5.5} fill={ACCENT} />
      <circle cx={33} cy={33} r={5.5} fill="none" stroke="currentColor" strokeWidth={2} />
    </>
  ),

  // The grid cut into rectangles, one already claimed.
  shikaku: (
    <>
      <rect x={6} y={24} width={24} height={18} fill={ACCENT} fillOpacity={0.15} />
      <g stroke={ACCENT} strokeWidth={2.5} fill="none" strokeLinejoin="round">
        <rect x={6} y={6} width={36} height={36} />
        <path d="M6 24H30M30 6V42" />
      </g>
    </>
  ),

  // The stuck block, the exit gap, the way out.
  rewind: (
    <>
      <path
        d="M42 16V6H6V42H42V32"
        fill="none"
        stroke={RULE}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <rect x={10} y={10} width={8} height={16} rx={1.5} fill="currentColor" opacity={0.15} />
      <rect x={22} y={10} width={16} height={8} rx={1.5} fill="currentColor" opacity={0.15} />
      <rect x={10} y={30} width={16} height={8} rx={1.5} fill="currentColor" opacity={0.15} />
      <rect x={16} y={20} width={16} height={8} rx={1.5} fill={ACCENT} />
      <path d="M35 24h6" stroke={ACCENT} strokeWidth={2.2} strokeDasharray="2.5 2.5" />
      <path d="M45 24l-5-3v6Z" fill={ACCENT} />
    </>
  ),

  // Telegraphed squares: the enemy shows its hand, the player reads it.
  telegraph: (
    <>
      <g stroke={RULE} strokeWidth={2} fill="none">
        <rect x={6} y={6} width={36} height={36} />
        <path d="M18 6V42M30 6V42M6 18H42M6 30H42" />
      </g>
      <g fill={ACCENT} fillOpacity={0.15} stroke={ACCENT} strokeWidth={1.8} strokeDasharray="2.5 2">
        <rect x={18} y={18} width={12} height={12} />
        <rect x={30} y={18} width={12} height={12} />
      </g>
      <rect x={32} y={8} width={8} height={8} fill={ACCENT} />
      <circle cx={12} cy={36} r={4} fill="currentColor" />
    </>
  ),

  // Loose shapes above, a recognisable shadow below.
  shadowplay: (
    <>
      <g fill="none" stroke="currentColor" strokeWidth={2} opacity={0.6}>
        <circle cx={19} cy={16} r={6.5} />
        <path d="M28 10l9 6-6 9-9-6Z" strokeLinejoin="round" />
      </g>
      <path d="M8 38H40" stroke={RULE} strokeWidth={2} strokeLinecap="round" />
      <path d="M15 38a9 9 0 0 1 18 0Z" fill={ACCENT} />
    </>
  ),
};

const LABELS: Record<GameId, string> = {
  slitherlink: 'Slitherlink',
  bridges: 'Bridges',
  starbattle: 'Star Battle',
  pushpar: 'Push Par',
  lastpiece: 'Last Piece Standing',
  shikaku: 'Shikaku',
  rewind: 'Rewind',
  telegraph: 'Telegraph',
  shadowplay: 'Shadow Play',
};

export function GameLogo({
  game,
  size = 28,
  title,
}: {
  game: GameId;
  size?: number;
  /** Accessible name; pass '' for a purely decorative use next to the name. */
  title?: string;
}) {
  const label = title ?? LABELS[game];
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role={label ? 'img' : 'presentation'}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      {MARKS[game]}
    </svg>
  );
}
