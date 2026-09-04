/**
 * Where you are in the course, as a row of dots.
 *
 * It exists because "Level 3 of 10" is a fact and this is a shape: you can see
 * at a glance how much is behind you and how little is left, without reading.
 * It replaces nothing — the header still says the words — but a stranger four
 * levels in should be able to tell they are nearly through without doing
 * arithmetic.
 *
 * Deliberately dumb: it takes the states already worked out and draws them.
 * Nothing here knows what a level is, so all nine games can use it.
 */

export type DotState = 'done' | 'here' | 'todo';

export function CourseDots({
  states,
  label,
  onPick,
}: {
  states: DotState[];
  label?: string;
  /**
   * Go back to a level already cleared. Omit it and the dots are a picture.
   *
   * Only cleared levels and the current one are reachable: forward is where
   * the course is taking you anyway, and a course you can skip through stops
   * teaching. Backwards costs nothing and is the whole point — a rule you half
   * followed four boards ago should be two taps away, not a restart.
   */
  onPick?: (index: number) => void;
}) {
  if (states.length === 0) return null;
  const done = states.filter((s) => s === 'done').length;
  const here = states.indexOf('here');
  const caption = label ?? `Level ${here >= 0 ? here + 1 : done} of ${states.length}, ${done} cleared`;

  if (!onPick) {
    return (
      <div className="s-dots" role="img" aria-label={caption}>
        {states.map((s, i) => (
          <i key={i} className={s === 'todo' ? undefined : `is-${s}`} />
        ))}
      </div>
    );
  }

  return (
    <div className="s-dots" role="group" aria-label={caption}>
      {states.map((s, i) => {
        const reachable = s !== 'todo';
        return (
          <button
            key={i}
            type="button"
            className={s === 'todo' ? undefined : `is-${s}`}
            disabled={!reachable}
            aria-current={s === 'here' ? 'step' : undefined}
            aria-label={`Level ${i + 1}${s === 'done' ? ', cleared' : s === 'here' ? ', current' : ', not yet'}`}
            onClick={() => reachable && onPick(i)}
          />
        );
      })}
    </div>
  );
}
