/**
 * The hint ladder — shared by every game in the studio.
 *
 * The design rule it enforces: a hint should be a nudge before it is an
 * answer. Handing someone the move teaches them nothing and quietly removes
 * the only reward the game has. So each press goes exactly one rung further:
 *
 *   1  where to look   — pulses the thing that already determines something
 *   2  why             — one sentence, in the player's words
 *   3  what follows    — the next few forced moves, in the order you'd find
 *                        them, drawn on the board and left for you to play
 *   4  do it           — places the first one, then the ladder resets
 *
 * Rung 3 is the one that matters. It shows the reasoning travelling across
 * the board rather than handing over an isolated fact, and it is still the
 * player who makes the moves.
 *
 * Games supply a HintSource. Nothing in this file knows what a bridge is.
 */

import type { PlayMode } from '@sussed/core';

export type HintTier = 0 | 1 | 2 | 3;

export interface HintStep<TMove = unknown> {
  /** applied verbatim by the game when the ladder reaches its last rung */
  move: TMove;
  /** the thing to draw attention to — an island, a cell, a piece */
  focus: unknown;
  /** the thing the move acts on — an edge, a square */
  target: unknown;
  /** one sentence. Concrete and in the player's words, never "consider the constraints". */
  reason: string;
  /** placing something, or ruling something out */
  kind: 'place' | 'rule-out';
  /** optional badge, e.g. "x2" */
  label?: string;
}

/**
 * How a game shows its answer when the ladder has run out and the player is
 * still stuck.
 *
 * Two shapes, because a solved board is not always a picture. A deduction game
 * has an answer you can look at — the filled grid IS the reveal. A spatial game
 * ends with an EMPTY board, so flipping to its solved state shows nothing at
 * all; there, the answer is the sequence, and the move stack built for undo is
 * already a replay system.
 */
export type Revelation<TMove = unknown> =
  /** the finished board, for a game whose answer is a picture */
  | { kind: 'solved'; board: unknown }
  /** the solve played back, for a game whose answer is an order */
  | { kind: 'replay'; moves: TMove[] };

export interface HintSource<TMove = unknown> {
  /** the single next forced move, or null when nothing is forced */
  next(): HintStep<TMove> | null;
  /** up to `max` forced moves as a causal chain, each applied before the next */
  chain(max: number): HintStep<TMove>[];
  /** how to name the focus in a sentence, e.g. "the 4" */
  describeFocus(focus: unknown): string;
  /**
   * The answer, for the flip. Optional only so a game can be built before it
   * has one; a game that ships without it simply never offers the flip.
   */
  reveal?(): Revelation<TMove>;
}

export interface HintView<TMove = unknown> {
  tier: HintTier;
  used: number;
  budget: number;
  remaining: number;
  exhausted: boolean;
  message: string | null;
  focus: unknown | null;
  target: unknown | null;
  chain: HintStep<TMove>[];
  /** true once the flip is on offer — the ladder is spent and the game has an answer to show */
  canReveal: boolean;
  /** true once they took it */
  revealed: boolean;
}

/**
 * How many nudges a board allows.
 *
 * Free while learning, because there a hint IS the teaching. Budgeted after,
 * because help you can never run out of stops being worth asking for — and
 * because a solve with unlimited help isn't worth putting on a leaderboard.
 */
export const COURSE_FREE_UNTIL = 5;

export function hintBudget(mode: PlayMode, levelIndex: number | null, difficulty: number): number {
  if (mode === 'level') {
    return levelIndex !== null && levelIndex < COURSE_FREE_UNTIL ? Infinity : 6;
  }
  return ([0, 6, 5, 4][difficulty] ?? 4) as number;
}

const CHAIN_LENGTH = 4;

export class HintLadder<TMove = unknown> {
  private tier: HintTier = 0;
  private used = 0;
  private message: string | null = null;
  private focus: unknown | null = null;
  private target: unknown | null = null;
  private chainSteps: HintStep<TMove>[] = [];

  private readonly source: HintSource<TMove>;
  readonly budget: number;

  constructor(source: HintSource<TMove>, budget: number) {
    this.source = source;
    this.budget = budget;
  }

  private didReveal = false;

  get view(): HintView<TMove> {
    const exhausted = this.used >= this.budget;
    return {
      tier: this.tier,
      used: this.used,
      budget: this.budget,
      remaining: this.budget === Infinity ? Infinity : Math.max(0, this.budget - this.used),
      exhausted,
      message: this.message,
      focus: this.focus,
      target: this.target,
      chain: this.chainSteps,
      canReveal: exhausted && typeof this.source.reveal === 'function',
      revealed: this.didReveal,
    };
  }

  /**
   * Rung five: turn the board over.
   *
   * Offered only once the ladder is spent, and never before. A visible give-up
   * control next to a fresh board changes what the game is asking of you; one
   * that appears after you have genuinely run out of help is a kindness.
   *
   * Returns null when there is nothing to show or the budget is not yet spent.
   * What the caller does with it is where the honesty lives: on a level the
   * player flips back and still plays the moves, and on a daily this ends the
   * attempt unsolved. Revealed is never solved.
   */
  revealAnswer(): Revelation<TMove> | null {
    if (this.used < this.budget) return null;
    if (typeof this.source.reveal !== 'function') return null;
    this.didReveal = true;
    this.tier = 0;
    this.focus = null;
    this.target = null;
    this.chainSteps = [];
    this.message = null;
    return this.source.reveal();
  }

  /**
   * Advance one rung. Returns a move only on the last rung, so the caller
   * applies it — the ladder never reaches into the game's state itself.
   */
  press(): { apply?: TMove } {
    if (this.used >= this.budget) return {};

    const step = this.source.next();
    if (!step) {
      this.message = 'Nothing is forced from here — you may need to look further ahead.';
      return {};
    }

    this.used++;
    this.chainSteps = [];

    if (this.tier === 0) {
      this.tier = 1;
      this.focus = step.focus;
      this.target = null;
      this.message = `Look at ${this.source.describeFocus(step.focus)}. Something there is already decided.`;
      return {};
    }
    if (this.tier === 1) {
      this.tier = 2;
      this.focus = step.focus;
      this.target = step.target;
      this.message = step.reason;
      return {};
    }
    if (this.tier === 2) {
      this.tier = 3;
      this.focus = null;
      this.target = null;
      this.chainSteps = this.source.chain(CHAIN_LENGTH);
      const n = this.chainSteps.length;
      this.message = `${n === 1 ? 'This one follows' : `These ${n} follow, in this order`}. Play them yourself.`;
      return {};
    }

    // Last rung: hand it over, then start again from the bottom.
    this.tier = 0;
    this.focus = null;
    this.target = null;
    this.message = `Done for you. ${step.reason}`;
    return { apply: step.move };
  }

  /** Any real move resets the ladder — the next hint starts at "where to look". */
  clear(): void {
    this.tier = 0;
    this.message = null;
    this.focus = null;
    this.target = null;
    this.chainSteps = [];
  }
}

/**
 * Offered, never forced.
 *
 * After a quiet spell the game makes the nudge button visible — it does not
 * open anything, interrupt anything, or ask a question. A modal that appears
 * because you paused to think is the rudest thing a puzzle can do.
 */
export class StuckWatcher {
  private last = Date.now();
  private readonly afterMs: number;

  constructor(afterMs = 40_000) {
    this.afterMs = afterMs;
  }

  touch(): void {
    this.last = Date.now();
  }

  get isStuck(): boolean {
    return Date.now() - this.last > this.afterMs;
  }
}
