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
import { LADDER } from './ladder';
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

/**
 * The course: the teaching chapters, then the ladder.
 *
 * The teaching boards introduce one rule each and stop. The ladder carries on
 * from there, gentle to hard, so difficulty is how far you have got rather
 * than a menu in front of the board. It also takes every course past the ten
 * levels the daily waits for — three of the four games used to promise that
 * and then run out at five.
 */
export const LOOP_LEVELS: LevelSet = buildLevelSet('loop', [
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
  const base = { id: `loop-${levelId}`, game: 'loop' as const, date: '', number: 0 };

  const t = TEACHING.find((x) => x.chapter === chapter);
  if (t) {
    return {
      ...base,
      difficulty: 1,
    w: t.w,
    h: t.h,
    clues: t.clues,
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
