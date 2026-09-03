/**
 * The daily calendar.
 *
 * A game's "today" is a local calendar date, not a UTC timestamp — a player in
 * Auckland and one in London should each get a new puzzle at their own midnight.
 * Puzzle numbers count days since the game's epoch so they read like an issue
 * number ("Bridges #128") in share cards.
 */

export type IsoDate = `${number}-${number}-${number}`;

const DAY_MS = 86_400_000;

/** Local calendar date as YYYY-MM-DD. */
export function toIsoDate(d: Date = new Date()): IsoDate {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}` as IsoDate;
}

export function fromIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** Whole days between two ISO dates, ignoring clocks and DST. */
export function daysBetween(a: string, b: string): number {
  const ms = fromIsoDate(b).setHours(12, 0, 0, 0) - fromIsoDate(a).setHours(12, 0, 0, 0);
  return Math.round(ms / DAY_MS);
}

export function addDays(iso: string, n: number): IsoDate {
  const d = fromIsoDate(iso);
  d.setDate(d.getDate() + n);
  return toIsoDate(d);
}

/** Issue number for a date, 1-based from the game's epoch. */
export function puzzleNumber(epoch: string, date: string): number {
  return daysBetween(epoch, date) + 1;
}

/**
 * Difficulty ramps across the week — Monday gentle, Sunday brutal.
 * Gives returning players a reason to come back on a specific day.
 */
export function difficultyForDate(date: string): 1 | 2 | 3 {
  const dow = fromIsoDate(date).getDay(); // 0 Sun .. 6 Sat
  if (dow === 0 || dow === 6) return 3;
  if (dow === 1 || dow === 2) return 1;
  return 2;
}

/** Stable seed for a game on a date. Changing this reshuffles every puzzle. */
export function dailySeed(game: string, date: string): string {
  return `sussed:${game}:${date}`;
}
