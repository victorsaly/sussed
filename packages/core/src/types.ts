/** Types every game and the players service agree on. */

/** The immutable record of one completed (or abandoned) attempt. */
export interface PlayResult {
  /** game slug, e.g. "bridges" */
  game: string;
  /** local calendar date of the puzzle, YYYY-MM-DD */
  date: string;
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
 * Results are append-only and keyed by (player, game, date). Once a result is
 * marked solved it never changes, which is what makes offline sync a set merge
 * instead of a conflict-resolution problem. Guard it here, once, for everyone.
 */
export function resultKey(r: Pick<PlayResult, 'game' | 'date'>): string {
  return `${r.game}:${r.date}`;
}

export function mergeResults(local: PlayResult, remote: PlayResult): PlayResult {
  if (local.solved !== remote.solved) return local.solved ? local : remote;
  if (!local.solved) return local.finishedAt >= remote.finishedAt ? local : remote;
  // Both solved: the first genuine solve wins, then fewer hints, then faster.
  if (local.hints !== remote.hints) return local.hints < remote.hints ? local : remote;
  return local.ms <= remote.ms ? local : remote;
}

export interface PuzzleMeta {
  game: string;
  date: string;
  number: number;
  difficulty: 1 | 2 | 3;
}
