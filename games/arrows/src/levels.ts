/**
 * The course.
 *
 * Arrows Out leads the slate because it is the one game here that passes the
 * five-second test on its own: an arrow is a drawn instruction, and a path
 * threading itself out of a maze explains the rule while you watch it. So this
 * course is shorter than the deduction games' and does less talking. Three
 * boards teach the three things there are to know, and the remaining seven just
 * fill the board up until it looks impossible and still is not.
 *
 * The first three were authored by hand, because a teaching board has to say
 * exactly one thing and a generator has no opinion about that. The seven maze
 * levels came out of `construct.ts` at fixed seeds and were kept as literal
 * data — generating them at load would be fast, but "dealt on first paint"
 * means the board is data, not a computation.
 *
 * Every board here is re-checked by `tools/verify.ts`: it clears, its
 * arrowheads tell the truth, and the easy ones never narrow to a lucky guess.
 */

import { buildLevelSet, type LevelSet } from '@sussed/core';
import { LADDER } from './ladder';
import type { PathDef, Puzzle } from './engine';

interface Teaching {
  chapter: string;
  title: string;
  /** The one rule this board introduces, in the player's words. */
  teaches: string;
  difficulty: 1 | 2 | 3;
  w: number;
  h: number;
  paths: PathDef[];
}

export const TEACHING: Teaching[] = [
  {
    chapter: 'thread',
    title: 'Thread them out',
    teaches: 'Tap a path and it threads itself out, head first. The body just follows.',
    difficulty: 1,
    w: 5,
    h: 3,
    // Three paths, all free, no wrong tap available. Level one exists to
    // produce a success in the first five seconds, not to be a puzzle.
    paths: [
      { cells: [2, 1, 0], dir: 3 },
      { cells: [7, 8, 9], dir: 1 },
      { cells: [12, 11, 10], dir: 3 },
    ],
  },
  {
    chapter: 'head',
    title: 'Follow the head',
    teaches: 'Only the run from the arrowhead has to be clear. However long the tail is, it costs nothing.',
    difficulty: 1,
    w: 5,
    h: 4,
    // The five-cell path curls right across the board and still leaves first.
    // The two-cell one next to it is stuck. Length is visibly not the point.
    paths: [
      { cells: [10, 11, 6, 7, 2], dir: 0 },
      { cells: [15, 16, 17], dir: 1 },
      { cells: [19, 14], dir: 0 },
    ],
  },
  {
    chapter: 'blocked',
    title: 'One at a time',
    teaches: 'Only one of these can go. Tap a blocked one and nothing moves — that is a miss.',
    difficulty: 2,
    w: 5,
    h: 4,
    // Exactly one path is free from the opening position, and clearing it frees
    // two more. The first deliberate bottleneck, on a board small enough to scan.
    paths: [
      { cells: [5, 0, 1], dir: 1 },
      { cells: [2, 3, 4], dir: 1 },
      { cells: [17, 12], dir: 0 },
      { cells: [19, 18], dir: 3 },
    ],
  },
  {
    chapter: 'maze-01',
    title: 'A little fuller',
    teaches: 'Same rule, more to look at.',
    difficulty: 1,
    w: 5,
    h: 5,
    // 5 paths · 60% full · tightest 80% free
    paths: [
      { cells: [2, 3, 8], dir: 2 },
      { cells: [23, 18, 19], dir: 1 },
      { cells: [14, 9, 4], dir: 0 },
      { cells: [12, 11, 6], dir: 0 },
      { cells: [17, 22, 21], dir: 3 },
    ],
  },
  {
    chapter: 'maze-02',
    title: 'Longer tails',
    teaches: 'The tails get longer. They still do not matter.',
    difficulty: 1,
    w: 5,
    h: 6,
    // 5 paths · 63% full · tightest 50% free
    paths: [
      { cells: [23, 18, 13, 14], dir: 1 },
      { cells: [3, 4, 9, 8], dir: 3 },
      { cells: [19, 24, 29, 28], dir: 3 },
      { cells: [22, 17, 16, 15], dir: 3 },
      { cells: [27, 26, 25], dir: 3 },
    ],
  },
  {
    chapter: 'maze-03',
    title: 'Two ways to start',
    teaches: 'Order never matters. Finding one that can go is the whole job.',
    difficulty: 2,
    w: 6,
    h: 6,
    // 6 paths · 69% full · tightest 20% free · 2 bottlenecks
    paths: [
      { cells: [16, 10, 4, 3], dir: 3 },
      { cells: [32, 31, 30, 24, 25], dir: 1 },
      { cells: [29, 23, 22], dir: 3 },
      { cells: [34, 28, 27, 26, 20], dir: 0 },
      { cells: [19, 13, 12], dir: 3 },
      { cells: [15, 14, 8, 2, 1], dir: 3 },
    ],
  },
  {
    chapter: 'maze-04',
    title: 'Crowded',
    teaches: 'Nearly four cells in five are covered.',
    difficulty: 2,
    w: 6,
    h: 7,
    // 7 paths · 79% full · tightest 20% free · 2 bottlenecks
    paths: [
      { cells: [0, 1, 2, 3, 9], dir: 2 },
      { cells: [37, 36, 30, 31], dir: 1 },
      { cells: [15, 16, 22, 21], dir: 3 },
      { cells: [38, 39, 33, 34, 28, 27], dir: 3 },
      { cells: [5, 11, 17, 23, 29, 35], dir: 2 },
      { cells: [14, 8, 7], dir: 3 },
      { cells: [32, 26, 25, 19, 18], dir: 3 },
    ],
  },
  {
    chapter: 'maze-05',
    title: 'Across the board',
    teaches: 'A path can run the whole width and still be the easy one.',
    difficulty: 2,
    w: 6,
    h: 7,
    // 7 paths · 76% full · tightest 33% free · 1 bottleneck
    paths: [
      { cells: [34, 33, 27], dir: 0 },
      { cells: [37, 38, 32, 26], dir: 0 },
      { cells: [0, 1, 2, 3, 9, 8], dir: 3 },
      { cells: [15, 21, 22, 28, 29, 23], dir: 0 },
      { cells: [19, 20, 14, 13, 7, 6], dir: 3 },
      { cells: [12, 18, 24], dir: 2 },
      { cells: [16, 17, 11, 5], dir: 0 },
    ],
  },
  {
    chapter: 'maze-06',
    title: 'Nine at once',
    teaches: 'Nine paths. One of them can go.',
    difficulty: 3,
    w: 7,
    h: 7,
    // 9 paths · 82% full · tightest 17% free · 3 bottlenecks
    paths: [
      { cells: [13, 12, 11, 4, 3, 2, 9], dir: 2 },
      { cells: [21, 28, 29], dir: 1 },
      { cells: [37, 30, 31, 32, 33, 40, 39], dir: 3 },
      { cells: [23, 16, 15, 14], dir: 3 },
      { cells: [25, 18, 19, 20, 27], dir: 2 },
      { cells: [42, 35, 36, 43], dir: 2 },
      { cells: [7, 8, 1, 0], dir: 3 },
      { cells: [38, 45, 46], dir: 1 },
      { cells: [34, 41, 48], dir: 2 },
    ],
  },
  {
    chapter: 'maze-07',
    title: 'The maze',
    teaches: 'It always comes apart. The work is seeing where.',
    difficulty: 3,
    w: 7,
    h: 8,
    // 8 paths · 82% full · tightest 17% free · 2 bottlenecks
    paths: [
      { cells: [3, 4, 11, 18, 19, 26], dir: 2 },
      { cells: [16, 9, 2, 1, 0, 7, 14], dir: 2 },
      { cells: [24, 25, 32, 33, 34, 41, 40], dir: 3 },
      { cells: [42, 35, 28, 21, 22, 29], dir: 2 },
      { cells: [38, 45, 52, 51], dir: 3 },
      { cells: [55, 48, 47, 46, 53, 54], dir: 1 },
      { cells: [27, 20, 13, 6], dir: 0 },
      { cells: [23, 30, 37, 36, 43, 50], dir: 2 },
    ],
  },
];

/**
 * Ten boards that teach, then the shared ladder on top — comfortably past the
 * ten levels `DAILY_UNLOCKS_AFTER` waits for. A daily shown to a stranger is a
 * hard puzzle with no context; a daily shown to someone who has just cleared
 * the maze is the next one.
 */
export const ARROWS_LEVELS: LevelSet = buildLevelSet('arrows', [
  ...TEACHING.map((t) => ({
    id: t.chapter,
    title: t.title,
    teaches: t.teaches,
    levels: [{ difficulty: t.difficulty }],
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
  const base = { id: `arrows-${levelId}`, game: 'arrows' as const, date: '', number: 0 };

  const t = TEACHING.find((x) => x.chapter === chapter);
  if (t) return { ...base, difficulty: t.difficulty, w: t.w, h: t.h, paths: t.paths };

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
