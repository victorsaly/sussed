/**
 * Arrows Out — rules only. Pure TypeScript, no React, no DOM.
 *
 * Tap an arrow. If its path is clear it slides that way, and if nothing stops
 * it before the edge it leaves the board. If something IS in the way, the tap
 * turns it 90° instead. Clear the board. Every tap counts, and each puzzle
 * ships with the fewest taps that will do it.
 *
 * That rotation rule is load-bearing, and it replaced an earlier design where a
 * blocked arrow simply refused to move. The reason is worth recording, because
 * it is not obvious and it cost a solver to find:
 *
 *   A game whose only action REMOVES pieces is confluent. Taking a piece off
 *   the board never makes anything harder, so if a solution exists at all, you
 *   can reach it by tapping whatever moves, in any order. Measured over 400
 *   random boards: every solvable one could be cleared greedily, and par always
 *   equalled the arrow count. There was no decision in it.
 *
 * Rotation is what introduces a cost that can be spent badly. It also means no
 * board can ever become unsolvable — you can always turn an arrow back around —
 * so a player is never stranded, only slower. Forgiving to play, real to master.
 */

export type Dir = 0 | 1 | 2 | 3; // N E S W

export const DX: readonly number[] = [0, 1, 0, -1];
export const DY: readonly number[] = [-1, 0, 1, 0];
export const GLYPH = ['↑', '→', '↓', '←'] as const;

export interface TileDef {
  x: number;
  y: number;
  dir: Dir;
}

export interface Puzzle {
  id: string;
  game: 'arrows';
  /** ISO date for a daily; empty for a course level, as in the other games */
  date: string;
  number: number;
  difficulty: 1 | 2 | 3;
  w: number;
  h: number;
  tiles: TileDef[];
  /** fewest taps that clear the board */
  par: number;
}

export const GONE = -1;

/**
 * Position and facing of every arrow. Direction is part of the state now, not
 * just the puzzle, because tapping a blocked arrow turns it.
 */
export interface State {
  readonly pos: readonly number[];
  readonly dir: readonly Dir[];
}

export const cell = (p: Puzzle, x: number, y: number): number => y * p.w + x;
export const cellX = (p: Puzzle, c: number): number => c % p.w;
export const cellY = (p: Puzzle, c: number): number => Math.floor(c / p.w);

export function initialState(p: Puzzle): State {
  return {
    pos: p.tiles.map((t) => cell(p, t.x, t.y)),
    dir: p.tiles.map((t) => t.dir),
  };
}

export function occupancy(p: Puzzle, state: State): Int16Array {
  const grid = new Int16Array(p.w * p.h).fill(-1);
  for (let i = 0; i < state.pos.length; i++) {
    const c = state.pos[i]!;
    if (c !== GONE) grid[c] = i;
  }
  return grid;
}

export interface SlideResult {
  /** the cell it settles on, GONE if it leaves the board */
  to: number;
  /** cells travelled — 0 means blocked, so the tap turns it instead */
  distance: number;
}

export function slide(p: Puzzle, state: State, tile: number, grid?: Int16Array): SlideResult {
  const from = state.pos[tile];
  if (from === undefined || from === GONE) return { to: GONE, distance: 0 };

  const occ = grid ?? occupancy(p, state);
  const d = state.dir[tile]!;
  const dx = DX[d]!;
  const dy = DY[d]!;

  let x = cellX(p, from);
  let y = cellY(p, from);
  let travelled = 0;

  for (;;) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= p.w || ny < 0 || ny >= p.h) return { to: GONE, distance: travelled + 1 };
    if (occ[ny * p.w + nx] !== -1) return { to: cell(p, x, y), distance: travelled };
    x = nx;
    y = ny;
    travelled++;
  }
}

export type MoveKind = 'slide' | 'exit' | 'turn';

export interface MoveResult {
  state: State;
  kind: MoveKind;
}

/**
 * The one player action. Never returns null: a blocked arrow turns, so every
 * tap on a live arrow does something visible. Nothing to explain, nothing to
 * shake at.
 */
export function tap(p: Puzzle, state: State, tile: number): MoveResult | null {
  if (state.pos[tile] === GONE) return null;
  const result = slide(p, state, tile);

  if (result.distance === 0) {
    const dir = state.dir.slice();
    dir[tile] = ((dir[tile]! + 1) % 4) as Dir;
    return { state: { pos: state.pos, dir }, kind: 'turn' };
  }

  const pos = state.pos.slice();
  pos[tile] = result.to;
  return { state: { pos, dir: state.dir }, kind: result.to === GONE ? 'exit' : 'slide' };
}

export const isSolved = (state: State): boolean => state.pos.every((c) => c === GONE);

export const cleared = (state: State): number =>
  state.pos.reduce<number>((n, c) => n + (c === GONE ? 1 : 0), 0);

/** Stable key for search memoisation. Position and facing both matter. */
export const key = (state: State): string => `${state.pos.join(',')}|${state.dir.join('')}`;

/**
 * The floor on par: every arrow must leave, and leaving costs one tap. Any par
 * above this is rotations — i.e. the part of the puzzle that is actually a
 * puzzle.
 */
export const parFloor = (p: Puzzle): number => p.tiles.length;
