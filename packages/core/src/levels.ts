/**
 * Levels — how a game teaches itself.
 *
 * The rule this file exists to enforce: a player learns by playing, never by
 * reading. So a chapter introduces exactly one new mechanic, on a board simple
 * enough that the mechanic is the only thing happening, and level one of any
 * game cannot be failed. Nobody has ever quit a game they just won.
 *
 * Progress is DERIVED from the result set rather than stored as a counter. A
 * stored "furthest level" drifts the moment two devices disagree; recomputing
 * from append-only results is always right and always agrees with whatever
 * synced last.
 */

import type { PlayResult } from './types';

export interface LevelRef {
  /** stable id, e.g. "2-04". Never renumber these — they are in player records. */
  id: string;
  chapter: string;
  /** position across the whole set, 0-based */
  index: number;
  difficulty: 1 | 2 | 3;
}

export interface Chapter {
  id: string;
  title: string;
  /**
   * The one rule this chapter introduces, in the player's words.
   * If a chapter needs two sentences here, it should be two chapters.
   */
  teaches: string;
  levels: LevelRef[];
}

export interface LevelSet {
  game: string;
  chapters: Chapter[];
}

export interface Progress {
  solved: ReadonlySet<string>;
  /** index of the furthest level solved, or -1 before the first */
  furthestIndex: number;
  levelsSolved: number;
}

/** How many levels a player must clear before the daily is offered at all. */
export const DAILY_UNLOCKS_AFTER = 10;

/** How far ahead of their furthest solve a player may skip. */
export const LOOKAHEAD = 1;

export function allLevels(set: LevelSet): LevelRef[] {
  return set.chapters.flatMap((c) => c.levels);
}

export function levelById(set: LevelSet, id: string): LevelRef | null {
  for (const chapter of set.chapters) {
    const found = chapter.levels.find((l) => l.id === id);
    if (found) return found;
  }
  return null;
}

/** Assigns ids and indices so a level set can be authored as plain arrays. */
export function buildLevelSet(
  game: string,
  chapters: { id: string; title: string; teaches: string; levels: { difficulty: 1 | 2 | 3 }[] }[],
): LevelSet {
  let index = 0;
  return {
    game,
    chapters: chapters.map((c) => ({
      id: c.id,
      title: c.title,
      teaches: c.teaches,
      levels: c.levels.map((l, i) => ({
        id: `${c.id}-${`${i + 1}`.padStart(2, '0')}`,
        chapter: c.id,
        index: index++,
        difficulty: l.difficulty,
      })),
    })),
  };
}

export function buildProgress(set: LevelSet, results: readonly PlayResult[]): Progress {
  const solved = new Set<string>();
  for (const r of results) {
    if (r.mode === 'level' && r.solved && r.game === set.game) solved.add(r.puzzle);
  }
  let furthestIndex = -1;
  for (const level of allLevels(set)) {
    if (solved.has(level.id)) furthestIndex = Math.max(furthestIndex, level.index);
  }
  return { solved, furthestIndex, levelsSolved: solved.size };
}

/**
 * A level is playable if it is at most LOOKAHEAD beyond the furthest solve.
 * Being stuck on one puzzle should never be the end of the game — but the
 * course still has to hold, or the teaching order stops meaning anything.
 */
export function isUnlocked(level: LevelRef, progress: Progress): boolean {
  return level.index <= progress.furthestIndex + 1 + LOOKAHEAD;
}

/** The level to drop the player straight into when they arrive. */
export function nextLevel(set: LevelSet, progress: Progress): LevelRef | null {
  return allLevels(set).find((l) => !progress.solved.has(l.id)) ?? null;
}

export function chapterProgress(chapter: Chapter, progress: Progress): {
  solved: number;
  total: number;
  complete: boolean;
} {
  const solved = chapter.levels.filter((l) => progress.solved.has(l.id)).length;
  return { solved, total: chapter.levels.length, complete: solved === chapter.levels.length };
}

/**
 * The daily is hidden until someone knows how to play. Shown to a stranger it
 * is a hard puzzle with no context; shown to a player it is the reason to come
 * back tomorrow. Same puzzle, opposite effect.
 */
export function dailyUnlocked(progress: Progress): boolean {
  return progress.levelsSolved >= DAILY_UNLOCKS_AFTER;
}
