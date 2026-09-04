/**
 * Per-device preferences. Deliberately not part of a player's record.
 *
 * The invariant next door is that level progress is DERIVED from results and
 * never stored, because a stored counter drifts the moment two devices
 * disagree. Nothing here is progress. These are choices about how this device
 * behaves, they are allowed to differ between devices, and the worst case if
 * one is lost is that somebody makes it again.
 *
 * localStorage rather than IndexedDB because these are read during the first
 * render, before anything async has settled, and a board is on screen by then.
 * Every access is wrapped: a private window or a browser with site data
 * blocked throws on the property itself, not just on the call.
 */

const key = (game: string, name: string): string => `sussed:${game}:${name}`;

function read(game: string, name: string): string | null {
  try {
    return localStorage.getItem(key(game, name));
  } catch {
    return null;
  }
}

function write(game: string, name: string, value: string): void {
  try {
    localStorage.setItem(key(game, name), value);
  } catch {
    // A preference that cannot be saved is not worth interrupting anyone over.
  }
}

/**
 * Has this player said they already know how to play?
 *
 * The course exists because a daily shown to a stranger is a hard puzzle with
 * no context. It is not there to detain someone who has played for a month and
 * arrived on a new phone, so there is one quiet way past it — and it stays
 * past, because being asked again every visit is its own small insult.
 */
export function courseSkipped(game: string): boolean {
  return read(game, 'course-skipped') === '1';
}

export function skipCourse(game: string): void {
  write(game, 'course-skipped', '1');
}
