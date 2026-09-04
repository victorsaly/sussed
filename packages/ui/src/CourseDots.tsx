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

export function CourseDots({ states, label }: { states: DotState[]; label?: string }) {
  if (states.length === 0) return null;
  const done = states.filter((s) => s === 'done').length;
  const here = states.indexOf('here');
  return (
    <div
      className="s-dots"
      role="img"
      aria-label={
        label ??
        `Level ${here >= 0 ? here + 1 : done} of ${states.length}, ${done} cleared`
      }
    >
      {states.map((s, i) => (
        <i key={i} className={s === 'todo' ? undefined : `is-${s}`} />
      ))}
    </div>
  );
}
