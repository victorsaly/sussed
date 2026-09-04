/**
 * The course.
 *
 * Two Stars has a tiny rule set and a cold start: a grid of shapes and no
 * visible goal. These boards fix that. The first three chapters use one star
 * per line, because one star is enough to teach every rule; only the last
 * chapter steps up to the two stars the daily uses.
 *
 * Every board here was checked by the real solver: each has exactly one
 * answer and needs no guessing.
 */

import { buildLevelSet, type LevelSet } from '@sussed/core';
import { LADDER } from './ladder';
import type { Puzzle } from './engine';

interface Teaching {
  chapter: string;
  title: string;
  teaches: string;
  n: number;
  stars: number;
  /** region index per cell, row-major */
  regions: number[];
}

export const TEACHING: Teaching[] = [
  {
    chapter: 'one',
    title: 'One in each',
    teaches: 'Put one star in every row, every column and every outlined shape. Tap a cell.',
    n: 4,
    stars: 1,
    regions: [0, 1, 1, 1, 0, 3, 2, 2, 3, 3, 2, 2, 3, 3, 3, 2],
  },
  {
    chapter: 'touch',
    title: 'Never touching',
    teaches: 'Stars never touch, not even at a corner.',
    n: 5,
    stars: 1,
    regions: [1, 1, 1, 3, 3, 1, 1, 3, 3, 3, 4, 1, 1, 2, 3, 0, 0, 2, 2, 2, 0, 0, 2, 2, 2],
  },
  {
    chapter: 'dot',
    title: 'Rule it out',
    teaches: 'Tap a cell twice for a dot: not here. Faint dots appear on their own where a star can no longer go.',
    n: 5,
    stars: 1,
    regions: [1, 1, 1, 3, 3, 1, 1, 3, 3, 3, 1, 4, 3, 2, 2, 4, 4, 4, 0, 0, 4, 4, 4, 0, 0],
  },
  {
    chapter: 'two',
    title: 'Two stars',
    teaches: 'Now two stars in every row, column and shape. Still never touching.',
    n: 8,
    stars: 2,
    regions: [
      2, 2, 2, 2, 2, 5, 5, 5, 1, 7, 7, 7, 7, 5, 5, 5, 1, 7, 4, 4, 7, 7, 7, 7, 1, 1, 1, 4, 4, 4, 4, 7, 1, 1, 1, 4, 4, 0, 0, 0,
      6, 1, 1, 6, 0, 0, 0, 0, 6, 6, 6, 6, 6, 3, 0, 3, 6, 6, 3, 3, 3, 3, 3, 3,
    ],
  },
];

/**
 * The course: the teaching chapters, then the ladder.
 *
 * The teaching boards introduce one rule each and stop. The ladder carries on
 * from there, gentle to hard, so difficulty is how far you have got rather
 * than a menu in front of the board. It also takes every course past the ten
 * levels the daily waits for — three of the four games used to promise that
 * and then run out at five.
 */
export const TWOSTARS_LEVELS: LevelSet = buildLevelSet('twostars', [
  ...TEACHING.map((t) => ({
    id: t.chapter,
    title: t.title,
    teaches: t.teaches,
    levels: [{ difficulty: 1 as const }],
  })),
  ...LADDER.map((r) => ({
    id: r.chapter,
    title: r.title,
    teaches: r.teaches,
    levels: [{ difficulty: r.difficulty }],
  })),
]);

/** Level ids are stable and appear in player records — never renumber them. */
export function levelPuzzle(levelId: string): Puzzle | null {
  const chapter = levelId.replace(/-\d+$/, '');
  const base = { id: `twostars-${levelId}`, game: 'twostars' as const, date: '', number: 0 };

  const t = TEACHING.find((x) => x.chapter === chapter);
  if (t) {
    return {
      ...base,
      difficulty: 1,
    n: t.n,
    stars: t.stars,
    regions: t.regions,
    };
  }

  const rung = LADDER.find((x) => x.chapter === chapter);
  if (rung) return { ...base, difficulty: rung.difficulty, ...rung.board };

  return null;
}

/**
 * The chapter's words. Narrower than `Teaching` on purpose: a ladder rung has
 * a title and a line of its own but no board of its own shape, and callers
 * only ever want what to say.
 */
export interface ChapterText {
  chapter: string;
  title: string;
  teaches: string;
}

export function teachingFor(levelId: string): ChapterText | null {
  const chapter = levelId.replace(/-\d+$/, '');
  const t = TEACHING.find((x) => x.chapter === chapter);
  if (t) return { chapter: t.chapter, title: t.title, teaches: t.teaches };
  const rung = LADDER.find((x) => x.chapter === chapter);
  return rung ? { chapter: rung.chapter, title: rung.title, teaches: rung.teaches } : null;
}
