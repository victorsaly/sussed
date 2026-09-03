import type { HintView } from '@sussed/player';

/**
 * One button, four rungs.
 *
 * It shows what's left rather than hiding it — a budget you can't see feels
 * arbitrary the moment it runs out. And when the player has been still for a
 * while it starts breathing: offered, never forced. No modal has ever helped
 * someone who was simply thinking.
 */
export function NudgeButton({
  hints,
  offered,
  onPress,
}: {
  hints: HintView;
  offered: boolean;
  onPress: () => void;
}) {
  const free = hints.budget === Infinity;
  const label = ['Nudge', 'Why?', 'What follows?', 'Show me'][hints.tier] ?? 'Nudge';

  return (
    <button
      className={`s-btn ${offered && !hints.exhausted ? 's-btn-offered' : 's-btn-quiet'}`}
      onClick={onPress}
      disabled={hints.exhausted}
      aria-label={free ? 'Nudge, free' : `Nudge, ${hints.remaining} left`}
    >
      {hints.exhausted ? 'No nudges left' : label}
      <span className={`s-pill ${free ? 's-pill-free' : ''}`}>
        {free ? 'free' : hints.remaining}
      </span>
    </button>
  );
}
