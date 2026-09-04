/**
 * The course.
 *
 * Loop has the coldest start in the studio: a grid of numbers and no visible
 * goal. These boards fix that. Each chapter introduces exactly one rule, on a
 * board small enough that the rule is the only thing happening.
 *
 * Every board here was checked by the real solver: each has exactly one
 * answer and needs no guessing.
 */

import { buildLevelSet, type LevelSet } from '@sussed/core';
import type { Puzzle } from './engine';

interface Teaching {
  chapter: string;
  title: string;
  teaches: string;
  w: number;
  h: number;
  /** row-major, -1 for no number */
  clues: number[];
}

export const TEACHING: Teaching[] = [
  {
    chapter: 'draw',
    title: 'One loop',
    teaches: 'Draw one closed loop. Tap between two dots for a line.',
    w: 2,
    h: 2,
    clues: [2, 2, 2, 2],
  },
  {
    chapter: 'count',
    title: 'Count the sides',
    teaches: 'A number is how many of that cell’s sides the loop uses.',
    w: 3,
    h: 2,
    clues: [1, 3, 2, 1, 2, 3],
  },
  {
    chapter: 'blank',
    title: 'Blanks are free',
    teaches: 'A cell with no number can have any number of sides.',
    w: 3,
    h: 3,
    clues: [1, -1, 1, -1, -1, -1, -1, 3, 2],
  },
  {
    chapter: 'cross',
    title: 'Rule it out',
    teaches: 'A 0 touches no line. Tap a side twice for a cross: definitely not here.',
    w: 4,
    h: 3,
    clues: [2, 2, -1, 0, 2, -1, 3, -1, -1, -1, 1, -1],
  },
  {
    chapter: 'auto',
    title: 'Watch the crosses',
    teaches: 'Faint crosses appear on their own where a side can no longer be used.',
    w: 4,
    h: 4,
    clues: [0, -1, -1, 0, -1, -1, -1, -1, 3, 1, 0, 2, 1, -1, -1, -1],
  },
];

export const LOOP_LEVELS: LevelSet = buildLevelSet(
  'loop',
  TEACHING.map((t) => ({
    id: t.chapter,
    title: t.title,
    teaches: t.teaches,
    levels: [{ difficulty: 1 as const }],
  })),
);

/** Level ids are stable and appear in player records — never renumber them. */
export function levelPuzzle(levelId: string): Puzzle | null {
  const chapter = levelId.replace(/-\d+$/, '');
  const t = TEACHING.find((x) => x.chapter === chapter);
  if (!t) return null;
  return {
    id: `loop-${levelId}`,
    game: 'loop',
    date: '',
    number: 0,
    difficulty: 1,
    w: t.w,
    h: t.h,
    clues: t.clues,
  };
}

export function teachingFor(levelId: string): Teaching | null {
  const chapter = levelId.replace(/-\d+$/, '');
  return TEACHING.find((x) => x.chapter === chapter) ?? null;
}
