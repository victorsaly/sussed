/**
 * Two Stars (Star Battle) — rules only. Pure TypeScript, no React, no DOM.
 *
 * This file must stay importable from a Node build script, because the
 * generator and the CI verifier both run it outside a browser.
 *
 * Rules: an n×n grid is cut into n regions. Place stars so that every row,
 * every column and every region holds exactly `stars` of them, and no two
 * stars touch — not even at a corner.
 */

export interface Puzzle {
  /** stable id, e.g. "twostars-2026-09-04" */
  id: string;
  game: 'twostars';
  date: string;
  number: number;
  difficulty: 1 | 2 | 3;
  /** grid is n×n and there are n regions */
  n: number;
  /** stars per row, column and region */
  stars: number;
  /** region index for each cell, row-major, length n*n */
  regions: number[];
}

export const EMPTY = 0;
export const DOT = 1;
export const STAR = 2;
export type Mark = 0 | 1 | 2;

/** One mark per cell, row-major. This is the whole mutable game state. */
export type Cells = Mark[];

export interface Units {
  rows: number[][];
  cols: number[][];
  regions: number[][];
  /** the three units each cell belongs to: [row, col, region] */
  of: [number, number, number][];
  /** eight-way neighbours of each cell */
  around: number[][];
}

export function buildUnits(p: Puzzle): Units {
  const n = p.n;
  const rows: number[][] = Array.from({ length: n }, () => []);
  const cols: number[][] = Array.from({ length: n }, () => []);
  const regions: number[][] = Array.from({ length: n }, () => []);
  const of: [number, number, number][] = [];
  const around: number[][] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const r = p.regions[i] ?? 0;
      rows[y]!.push(i);
      cols[x]!.push(i);
      regions[r]!.push(i);
      of.push([y, x, r]);
      const nb: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < n && ny >= 0 && ny < n) nb.push(ny * n + nx);
        }
      }
      around.push(nb);
    }
  }
  return { rows, cols, regions, of, around };
}

export function emptyCells(p: Puzzle): Cells {
  return new Array<Mark>(p.n * p.n).fill(EMPTY);
}

/** A tap goes empty -> star -> dot -> empty. The star comes first because it is the move. */
export function cycleCell(cells: Cells, i: number): Cells {
  const next = cells.slice();
  const current = cells[i] ?? EMPTY;
  next[i] = current === EMPTY ? STAR : current === STAR ? DOT : EMPTY;
  return next;
}

export function starCount(cells: Cells, unit: number[]): number {
  let k = 0;
  for (const i of unit) if (cells[i] === STAR) k++;
  return k;
}

export interface Conflicts {
  /** cells drawn as wrong: touching stars, or stars in an over-full unit */
  cells: boolean[];
  touching: number;
  overRows: number;
  overCols: number;
  overRegions: number;
}

export function conflicts(p: Puzzle, u: Units, cells: Cells): Conflicts {
  const bad = new Array<boolean>(cells.length).fill(false);
  let touching = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== STAR) continue;
    for (const j of u.around[i]!) {
      if (j > i && cells[j] === STAR) {
        bad[i] = true;
        bad[j] = true;
        touching++;
      }
    }
  }
  const over = (units: number[][]): number => {
    let k = 0;
    for (const unit of units) {
      if (starCount(cells, unit) > p.stars) {
        k++;
        for (const i of unit) if (cells[i] === STAR) bad[i] = true;
      }
    }
    return k;
  };
  return {
    cells: bad,
    touching,
    overRows: over(u.rows),
    overCols: over(u.cols),
    overRegions: over(u.regions),
  };
}

/**
 * Cells that cannot hold a star given the stars already placed: next to a
 * star, or in a row, column or region that already has its share. The board
 * draws these as faint dots so the player sees what is left without marking
 * every one by hand.
 */
export function implied(p: Puzzle, u: Units, cells: Cells): boolean[] {
  const out = new Array<boolean>(cells.length).fill(false);
  const full = (unit: number[]): void => {
    if (starCount(cells, unit) < p.stars) return;
    for (const i of unit) if (cells[i] !== STAR) out[i] = true;
  };
  u.rows.forEach(full);
  u.cols.forEach(full);
  u.regions.forEach(full);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== STAR) continue;
    for (const j of u.around[i]!) if (cells[j] !== STAR) out[j] = true;
  }
  return out;
}

export function isSolved(p: Puzzle, u: Units, cells: Cells): boolean {
  const exact = (unit: number[]): boolean => starCount(cells, unit) === p.stars;
  if (!u.rows.every(exact) || !u.cols.every(exact) || !u.regions.every(exact)) return false;
  return conflicts(p, u, cells).touching === 0;
}

export interface Progress {
  /** stars placed so far */
  placed: number;
  /** stars the finished puzzle holds */
  total: number;
  rowsLeft: number;
  colsLeft: number;
  regionsLeft: number;
  /** pairs of stars touching */
  touching: number;
  /** rows, columns and regions with too many stars */
  over: number;
}

/** Everything the read-out under the board needs, in one pass. */
export function progress(p: Puzzle, u: Units, cells: Cells): Progress {
  const left = (units: number[][]): number => units.filter((unit) => starCount(cells, unit) < p.stars).length;
  const c = conflicts(p, u, cells);
  let placed = 0;
  for (const m of cells) if (m === STAR) placed++;
  return {
    placed,
    total: p.n * p.stars,
    rowsLeft: left(u.rows),
    colsLeft: left(u.cols),
    regionsLeft: left(u.regions),
    touching: c.touching,
    over: c.overRows + c.overCols + c.overRegions,
  };
}
