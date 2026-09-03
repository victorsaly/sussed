import type { PlayResult } from '@sussed/core';

/**
 * Three tiers, and the rule that governs all of them: moving up a tier never
 * costs the player anything they already had.
 *
 *  anonymous — a local id made on first load. Everything works. Nothing leaves
 *              the device. Most players stay here and that is a success.
 *  claimed   — the same local id, now bound to an account on the server. Their
 *              existing history travels with them. Asked for only after a
 *              result worth keeping.
 *  portable  — signed in on this device, history synced across all games and
 *              every device they own.
 */
export type Tier = 'anonymous' | 'claimed' | 'portable';

export interface Identity {
  /** stable local id, created once, never regenerated */
  deviceId: string;
  tier: Tier;
  /** set from `claimed` onwards */
  userId?: string;
  displayName?: string;
  /** short-lived bearer token; refreshed on demand, never stored in a cookie */
  token?: string;
  tokenExpiresAt?: number;
}

export interface Streak {
  current: number;
  best: number;
  /** date of the most recent solve, or null if they have never solved one */
  lastPlayed: string | null;
  /** true when today is unplayed and yesterday was solved — the nudge state */
  atRisk: boolean;
}

export interface GameStats {
  played: number;
  solved: number;
  streak: Streak;
  /** ms, over solved puzzles only */
  bestMs: number | null;
  averageMs: number | null;
  /** solves per weekday, Sunday first — the little bar chart in the stats panel */
  byWeekday: number[];
}

export interface PlayerStorage {
  getIdentity(): Promise<Identity | null>;
  setIdentity(id: Identity): Promise<void>;
  getResults(game?: string): Promise<PlayResult[]>;
  putResult(result: PlayResult): Promise<PlayResult>;
  /** results not yet acknowledged by the server */
  getUnsynced(): Promise<PlayResult[]>;
  markSynced(keys: string[]): Promise<void>;
  clear(): Promise<void>;
}

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  ms: number;
  moves: number;
  isYou: boolean;
}
