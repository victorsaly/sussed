/**
 * Arrows Out's side of the hint ladder.
 *
 * Nothing in `packages/player/src/hints.ts` knows what a path is; this file is
 * the whole of what it needs. A move here is a path index, because a tap is the
 * only thing a player can do.
 */

import type { HintSource, HintStep, Revelation } from '@sussed/player';
import { GLYPH, cellX, cellY, headCell, type Puzzle, type State } from './engine';
import { nextFree, solveFrom, unthreadChain } from './solver';

/**
 * Where a path is, in the words someone would actually use pointing at a phone.
 *
 * Named by its arrowhead rather than its tail, because the head is the end that
 * matters and the end the hint is about to highlight.
 */
export function describePath(p: Puzzle, index: number): string {
  const path = p.paths[index];
  if (!path) return 'that path';

  const head = headCell(path);
  const x = cellX(p, head);
  const y = cellY(p, head);

  const across = p.w <= 2 ? '' : x < p.w / 3 ? 'left' : x < (p.w * 2) / 3 ? '' : 'right';
  const down = p.h <= 2 ? '' : y < p.h / 3 ? 'top' : y < (p.h * 2) / 3 ? 'middle' : 'bottom';
  const where = [down, across].filter(Boolean).join(' ');

  return where ? `the ${GLYPH[path.dir]} on the ${where}` : `the ${GLYPH[path.dir]}`;
}

function toStep(p: Puzzle, index: number, reason: string): HintStep<number> {
  return {
    move: index,
    focus: index,
    target: index,
    reason,
    // Every hint here is "this one can go" — there is no ruling-out in a game
    // where the only action is a tap on something visible.
    kind: 'place',
  };
}

/**
 * The source. `getState` is a function rather than a value because the ladder
 * outlives any single position — the player keeps tapping between rungs.
 */
export function createHintSource(p: Puzzle, getState: () => State): HintSource<number> {
  return {
    next(): HintStep<number> | null {
      const hint = nextFree(p, getState());
      return hint ? toStep(p, hint.path, hint.reason) : null;
    },

    chain(max: number): HintStep<number>[] {
      return unthreadChain(p, getState(), max).map((hint) =>
        toStep(
          p,
          hint.path,
          // Inside a chain the wording changes: the player is being shown an
          // order, so each line says where in the order it sits rather than
          // repeating "this has a clear run" four times.
          `${describePath(p, hint.path)} comes out next.`,
        ),
      );
    },

    describeFocus(focus: unknown): string {
      return typeof focus === 'number' ? describePath(p, focus) : 'that path';
    },

    /**
     * The flip.
     *
     * A replay, not a picture, and Arrows is the reason that distinction exists
     * in the platform at all: a solved board here is an EMPTY board, so turning
     * it over to show the finished state would show a grid of nothing. The
     * answer to this game is the order, so the order is what gets played back —
     * from where the player actually is, not from the opening position.
     */
    reveal(): Revelation<number> {
      return { kind: 'replay', moves: solveFrom(p, getState()).order };
    },
  };
}
