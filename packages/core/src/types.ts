/** Types every game and the players service agree on. */

/**
 * How a puzzle was reached.
 *
 * `level` is how a game teaches: a hand-ordered course where each new rule gets
 * a board simple enough that the rule is the only thing happening.
 * `daily` is why someone comes back once they already know how to play.
 *
 * Both produce the same record. A daily is simply a result whose puzzle id
 * happens to be a date.
 */
export type PlayMode = 'daily' | 'level';

/** The immutable record of one completed (or abandoned) attempt. */
export interface PlayResult {
  /** game slug, e.g. "bridges" */
  game: string;
  /**
   * Identifies the puzzle inside the game: an ISO date for dailies, a level id
   * for levels. Widening this from a bare `date` is what lets one platform
   * serve both a daily deduction game and a level-based spatial one.
   */
  puzzle: string;
  mode: PlayMode;
  /** true once the board was solved */
  solved: boolean;
  /** wall time actually spent, excluding idle */
  ms: number;
  /** number of moves made */
  moves: number;
  /** hints used — leaderboards may exclude assisted solves */
  hints: number;
  /** 1..3 */
  difficulty: number;
  /** epoch ms the result was finalised, for tie-breaks and audit */
  finishedAt: number;
}

/**
 * Results are append-only and keyed by (player, game, puzzle). Once a result is
 * marked solved it never changes, which is what makes offline sync a set merge
 * instead of a conflict-resolution problem. Guard it here, once, for everyone.
 */
export function resultKey(r: Pick<PlayResult, 'game' | 'puzzle'>): string {
  return `${r.game}:${r.puzzle}`;
}

export function mergeResults(local: PlayResult, remote: PlayResult): PlayResult {
  if (local.solved !== remote.solved) return local.solved ? local : remote;
  if (!local.solved) return local.finishedAt >= remote.finishedAt ? local : remote;
  // Both solved: fewer hints wins, then faster.
  if (local.hints !== remote.hints) return local.hints < remote.hints ? local : remote;
  return local.ms <= remote.ms ? local : remote;
}

/** Convenience for the common case — a daily's puzzle id IS its date. */
export function dailyResult(
  game: string,
  date: string,
  rest: Omit<PlayResult, 'game' | 'puzzle' | 'mode'>,
): PlayResult {
  return { game, puzzle: date, mode: 'daily', ...rest };
}

export interface PuzzleMeta {
  game: string;
  puzzle: string;
  mode: PlayMode;
  /** issue number for dailies, level index for levels */
  number: number;
  difficulty: 1 | 2 | 3;
}
