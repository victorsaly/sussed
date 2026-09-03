/**
 * Display-name moderation.
 *
 * Puzzle games attract children, and a leaderboard is the one place strangers
 * can write something everyone reads. This is not sophisticated and does not
 * need to be — a length cap, a character allowlist and a small blocklist stops
 * the overwhelming majority of it, and a report link handles the rest.
 */

const BLOCKED = [
  // Kept deliberately short. Expand from real reports rather than guessing.
  'admin',
  'moderator',
  'sussed',
  'official',
];

const ALLOWED = /^[a-zA-Z0-9 _.-]+$/;

export function checkDisplayName(raw: string): { ok: true; name: string } | { ok: false; reason: string } {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return { ok: false, reason: 'Names need at least two characters.' };
  if (name.length > 20) return { ok: false, reason: 'Keep it to 20 characters or fewer.' };
  if (!ALLOWED.test(name)) {
    return { ok: false, reason: 'Letters, numbers, spaces, dots, dashes and underscores only.' };
  }
  const lower = name.toLowerCase();
  if (BLOCKED.some((word) => lower.includes(word))) {
    return { ok: false, reason: 'That name is reserved. Pick another.' };
  }
  return { ok: true, name };
}
