/**
 * The course.
 *
 * Bridges is a good puzzle with a cold start: a stranger sees numbered circles
 * and has no visible goal. These boards fix that. Each chapter introduces
 * exactly one rule, on a board small enough that the rule is the only thing
 * happening — and level one cannot be failed, because a tap that would overfill
 * an island is refused rather than accepted.
 *
 * Every board here was checked by the real solver: each has exactly one answer.
 */

import { buildLevelSet, type LevelSet } from '@sussed/core';
import { LADDER } from './ladder';
import type { IslandDef, Puzzle } from './engine';

interface Teaching {
  chapter: string;
  title: string;
  teaches: string;
  w: number;
  h: number;
  islands: IslandDef[];
}

export const TEACHING: Teaching[] = [
  {
    chapter: 'join',
    title: 'Join them up',
    teaches: 'Tap an island, then another. A line appears between them.',
    w: 5,
    h: 1,
    islands: [
      { x: 0, y: 0, n: 1 },
      { x: 2, y: 0, n: 2 },
      { x: 4, y: 0, n: 1 },
    ],
  },
  {
    chapter: 'double',
    title: 'Two at a time',
    teaches: 'Tap the same pair again for a double bridge.',
    w: 5,
    h: 1,
    islands: [
      { x: 0, y: 0, n: 2 },
      { x: 2, y: 0, n: 4 },
      { x: 4, y: 0, n: 2 },
    ],
  },
  {
    chapter: 'connect',
    title: 'All in one piece',
    teaches: 'Every number met — but they must also all end up connected.',
    w: 3,
    h: 3,
    islands: [
      { x: 0, y: 0, n: 2 },
      { x: 2, y: 0, n: 2 },
      { x: 2, y: 2, n: 2 },
      { x: 0, y: 2, n: 2 },
    ],
  },
  {
    chapter: 'cross',
    title: 'Nothing crosses',
    // The ✗ is taught by watching one appear, never by a modal explaining it.
    teaches: 'Bridges never cross. Watch the faint ✗ appear when one becomes impossible.',
    w: 5,
    h: 3,
    islands: [
      { x: 0, y: 0, n: 3 },
      { x: 4, y: 0, n: 2 },
      { x: 0, y: 2, n: 3 },
      { x: 4, y: 2, n: 2 },
      { x: 2, y: 0, n: 2 },
    ],
  },
  {
    chapter: 'rule-out',
    title: 'Rule it out',
    teaches: 'One more tap after the double marks it ✗ — definitely not here. That is how you keep track.',
    w: 5,
    h: 3,
    islands: [
      { x: 0, y: 0, n: 2 },
      { x: 4, y: 0, n: 3 },
      { x: 0, y: 2, n: 1 },
      { x: 4, y: 2, n: 2 },
      { x: 2, y: 2, n: 2 },
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
export const BRIDGES_LEVELS: LevelSet = buildLevelSet('bridges', [
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
  const base = { id: `bridges-${levelId}`, game: 'bridges' as const, date: '', number: 0 };

  const t = TEACHING.find((x) => x.chapter === chapter);
  if (t) {
    return {
      ...base,
      difficulty: 1,
    w: t.w,
    h: t.h,
    islands: t.islands,
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
