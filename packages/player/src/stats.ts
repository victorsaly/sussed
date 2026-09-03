/**
 * Streaks and stats, computed from the local result set.
 *
 * Deliberately derived rather than stored: a stored counter drifts the moment
 * two devices disagree, whereas recomputing from an append-only set of results
 * is always right and always agrees with whatever synced last.
 */

import { addDays, fromIsoDate, toIsoDate, type PlayResult } from '@sussed/core';
import type { GameStats, Streak } from './types';

export function computeStreak(results: PlayResult[], today = toIsoDate()): Streak {
  const solvedDates = new Set(results.filter((r) => r.solved).map((r) => r.date));
  if (solvedDates.size === 0) {
    return { current: 0, best: 0, lastPlayed: null, atRisk: false };
  }

  const sorted = [...solvedDates].sort();
  const last = sorted[sorted.length - 1] as string;

  // Current streak counts back from today, or from yesterday if today is
  // unplayed — a streak isn't broken until the day actually ends.
  let cursor = solvedDates.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (solvedDates.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of sorted) {
    run = previous !== null && addDays(previous, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }

  return {
    current,
    best: Math.max(best, current),
    lastPlayed: last,
    atRisk: current > 0 && !solvedDates.has(today),
  };
}

export function computeStats(results: PlayResult[], today = toIsoDate()): GameStats {
  const solved = results.filter((r) => r.solved);
  const times = solved.map((r) => r.ms).filter((ms) => ms > 0);
  const byWeekday = new Array<number>(7).fill(0);
  for (const r of solved) byWeekday[fromIsoDate(r.date).getDay()]!++;

  return {
    played: results.length,
    solved: solved.length,
    streak: computeStreak(results, today),
    bestMs: times.length ? Math.min(...times) : null,
    averageMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    byWeekday,
  };
}

/**
 * Should we offer to save their progress right now?
 *
 * Two moments, and only two: a result good enough to be worth showing, and a
 * streak old enough to be worth losing. Anything else is interruption.
 * Returns the exact sentence to show, because "create an account" converts
 * nobody and "you're on a 6-day streak" converts a lot of people.
 */
export function claimPrompt(
  stats: GameStats,
  justSolved: { ms: number; percentile?: number } | null,
): string | null {
  if (justSolved && justSolved.percentile !== undefined && justSolved.percentile <= 25) {
    return `That's a top ${Math.max(1, Math.round(justSolved.percentile))}% time today. Put it on the board?`;
  }
  if (stats.streak.current >= 3) {
    return `You're ${stats.streak.current} days in a row — that's only saved on this browser right now.`;
  }
  if (justSolved && stats.solved >= 3) {
    return `Three solved. Want your history to follow you to your phone?`;
  }
  return null;
}

export function formatMs(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${`${s}`.padStart(2, '0')}`;
}
