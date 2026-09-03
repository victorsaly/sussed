/**
 * Deterministic seeded randomness.
 *
 * Every puzzle in the studio is a pure function of a string seed, so the same
 * date produces the same board on every device, in CI, and a year from now.
 * Never use Math.random() anywhere a player could notice the difference.
 */

/** xmur3: string -> 32-bit seed. */
export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export interface Rng {
  /** float in [0, 1) */
  next(): number;
  /** integer in [0, n) */
  int(n: number): number;
  /** integer in [lo, hi] inclusive */
  range(lo: number, hi: number): number;
  /** random element; throws on empty */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates, returns a new array */
  shuffle<T>(items: readonly T[]): T[];
  /** true with probability p */
  chance(p: number): boolean;
}

/** mulberry32 — small, fast, good enough for puzzle generation. */
export function createRng(seed: string | number): Rng {
  let a = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  return {
    next,
    int,
    range: (lo, hi) => lo + int(hi - lo + 1),
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick() on empty array');
      return items[int(items.length)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    },
    chance: (p) => next() < p,
  };
}
