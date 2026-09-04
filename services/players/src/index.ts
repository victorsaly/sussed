/**
 * SUSSED players service — one deployment, every game.
 *
 * Everything a game needs that a static file cannot provide: an identity,
 * a synced history, and a leaderboard. Nothing else belongs in here.
 *
 * The load-bearing constraint is that this service is NEVER on the critical
 * path of a tap. Games write locally and call /sync afterwards. If this is
 * down, every game still works.
 */

import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { checkDisplayName } from './names';
import { newId, sign, verify, TOKEN_TTL_MS, type Claims } from './tokens';

export interface Env {
  DB: D1Database;
  TOKEN_SECRET: string;
  RP_ID: string; // e.g. sussed.games
  RP_ORIGIN: string; // e.g. https://sussed.games
  /** comma-separated list of game origins allowed to call this service */
  ALLOWED_ORIGINS: string;
  RESEND_API_KEY?: string;
}

type Ctx = { Bindings: Env; Variables: { claims: Claims } };

const app = new Hono<Ctx>();

app.use('*', async (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : allowed[0] ?? ''),
    allowHeaders: ['content-type', 'authorization', 'x-sussed-game'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  })(c, next);
});

/** Bearer auth. Every route below /auth requires it. */
async function requireAuth(c: Context<Ctx>, next: Next) {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const claims = await verify(token, c.env.TOKEN_SECRET);
  if (!claims) return c.json({ error: 'not signed in' }, 401);
  c.set('claims', claims);
  await next();
  return undefined;
}

const now = (): number => Date.now();

/* ------------------------------------------------------------------ auth */

/**
 * Tier 1. A device id in, a token out. No email, no name, no consent screen —
 * there is nothing here a person would need to consent to.
 */
app.post('/auth/anonymous', async (c) => {
  const { deviceId } = await c.req.json<{ deviceId?: string }>();
  if (!deviceId || deviceId.length > 64) return c.json({ error: 'bad device id' }, 400);

  const existing = await c.env.DB.prepare(
    'SELECT d.user_id as userId, u.tier as tier FROM devices d JOIN users u ON u.id = d.user_id WHERE d.device_id = ?',
  )
    .bind(deviceId)
    .first<{ userId: string; tier: 'anonymous' | 'portable' }>();

  let userId = existing?.userId;
  let tier: 'anonymous' | 'portable' = existing?.tier ?? 'anonymous';

  if (!userId) {
    userId = newId('usr');
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO users (id, tier, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ).bind(userId, 'anonymous', now(), now()),
      c.env.DB.prepare(
        'INSERT INTO devices (device_id, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)',
      ).bind(deviceId, userId, now(), now()),
    ]);
  } else {
    await c.env.DB.prepare('UPDATE devices SET last_seen = ? WHERE device_id = ?')
      .bind(now(), deviceId)
      .run();
  }

  const exp = now() + TOKEN_TTL_MS;
  const token = await sign({ sub: userId, dev: deviceId, tier, exp }, c.env.TOKEN_SECRET);
  return c.json({ token, expiresAt: exp, userId });
});

/**
 * Tier 2, step one. Note what this does NOT do: it does not create a new user.
 * It upgrades the one the device already has, so every result already filed
 * against it comes along. Losing someone's streak at the moment they agree to
 * sign up would be the worst possible trade.
 */
app.post('/auth/passkey/options', requireAuth, async (c) => {
  const { displayName } = await c.req.json<{ displayName?: string }>();
  const check = checkDisplayName(displayName ?? '');
  if (!check.ok) return c.json({ error: check.reason }, 400);

  const claims = c.get('claims');
  const options = await generateRegistrationOptions({
    rpName: 'SUSSED',
    rpID: c.env.RP_ID,
    userName: check.name,
    userDisplayName: check.name,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  const sessionId = newId('chl');
  await c.env.DB.prepare(
    'INSERT INTO challenges (id, user_id, kind, payload, expires_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(
      sessionId,
      claims.sub,
      'passkey',
      JSON.stringify({ challenge: options.challenge, displayName: check.name }),
      now() + 5 * 60 * 1000,
    )
    .run();

  return c.json({ options, sessionId });
});

app.post('/auth/passkey/verify', requireAuth, async (c) => {
  const { sessionId, credential } = await c.req.json<{ sessionId?: string; credential?: unknown }>();
  const claims = c.get('claims');

  const row = await c.env.DB.prepare(
    'SELECT payload, expires_at as expiresAt FROM challenges WHERE id = ? AND user_id = ? AND kind = ?',
  )
    .bind(sessionId ?? '', claims.sub, 'passkey')
    .first<{ payload: string; expiresAt: number }>();

  if (!row || row.expiresAt < now()) return c.json({ error: 'that took too long — try again' }, 400);
  const { challenge, displayName } = JSON.parse(row.payload) as {
    challenge: string;
    displayName: string;
  };

  const verified = await verifyRegistrationResponse({
    response: credential as never,
    expectedChallenge: challenge,
    expectedOrigin: c.env.RP_ORIGIN,
    expectedRPID: c.env.RP_ID,
  });

  if (!verified.verified || !verified.registrationInfo) {
    return c.json({ error: 'could not verify that passkey' }, 400);
  }

  const { credential: cred } = verified.registrationInfo;
  const exp = now() + TOKEN_TTL_MS;

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM challenges WHERE id = ?').bind(sessionId ?? ''),
    c.env.DB.prepare(
      'INSERT OR REPLACE INTO credentials (id, user_id, public_key, counter, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(
      cred.id,
      claims.sub,
      btoa(String.fromCharCode(...cred.publicKey)),
      cred.counter,
      now(),
    ),
    c.env.DB.prepare(
      'UPDATE users SET tier = ?, display_name = ?, updated_at = ? WHERE id = ?',
    ).bind('portable', displayName, now(), claims.sub),
  ]);

  const token = await sign(
    { sub: claims.sub, dev: claims.dev, tier: 'portable', exp },
    c.env.TOKEN_SECRET,
  );
  return c.json({ token, expiresAt: exp, userId: claims.sub, displayName });
});

/** The fallback for devices without a passkey. Same binding, same guarantee. */
app.post('/auth/magic/request', requireAuth, async (c) => {
  const { email, displayName } = await c.req.json<{ email?: string; displayName?: string }>();
  const check = checkDisplayName(displayName ?? '');
  if (!check.ok) return c.json({ error: check.reason }, 400);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return c.json({ error: 'that email does not look right' }, 400);
  }

  const claims = c.get('claims');
  const code = newId('mgc');
  await c.env.DB.prepare(
    'INSERT INTO challenges (id, user_id, kind, payload, expires_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(code, claims.sub, 'magic', JSON.stringify({ email, displayName: check.name }), now() + 15 * 60 * 1000)
    .run();

  const link = `${c.env.RP_ORIGIN}/claim?code=${code}`;

  if (c.env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${c.env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SUSSED <hello@sussed.games>',
        to: email,
        subject: 'Keep your streak',
        text: `Tap to save your progress — it stays on this link for 15 minutes.\n\n${link}\n\nIf you didn't ask for this, ignore it. Nothing has changed.`,
      }),
    }).catch(() => undefined);
  } else {
    // In development the link is logged rather than sent — no mail provider
    // needed to work on the flow.
    console.log('[magic link]', link);
  }

  return c.json({ sent: true });
});

app.post('/auth/magic/verify', async (c) => {
  const { code, deviceId } = await c.req.json<{ code?: string; deviceId?: string }>();
  const row = await c.env.DB.prepare(
    'SELECT user_id as userId, payload, expires_at as expiresAt FROM challenges WHERE id = ? AND kind = ?',
  )
    .bind(code ?? '', 'magic')
    .first<{ userId: string; payload: string; expiresAt: number }>();

  if (!row || row.expiresAt < now()) return c.json({ error: 'that link has expired' }, 400);
  const { email, displayName } = JSON.parse(row.payload) as { email: string; displayName: string };

  const statements = [
    c.env.DB.prepare('DELETE FROM challenges WHERE id = ?').bind(code ?? ''),
    c.env.DB.prepare(
      'UPDATE users SET tier = ?, email = ?, display_name = ?, updated_at = ? WHERE id = ?',
    ).bind('portable', email, displayName, now(), row.userId),
  ];
  // Binding a second device to the same account is how sign-in-elsewhere works.
  if (deviceId) {
    statements.push(
      c.env.DB.prepare(
        'INSERT OR REPLACE INTO devices (device_id, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)',
      ).bind(deviceId, row.userId, now(), now()),
    );
  }
  await c.env.DB.batch(statements);

  const exp = now() + TOKEN_TTL_MS;
  const token = await sign(
    { sub: row.userId, dev: deviceId ?? '', tier: 'portable', exp },
    c.env.TOKEN_SECRET,
  );
  return c.json({ token, expiresAt: exp, userId: row.userId, displayName });
});

/* ------------------------------------------------------------------ sync */

/**
 * Push and pull in one round trip, called on load, on focus and after a solve.
 * Never on a move — that single rule is why this fits in a free tier.
 *
 * The merge is a set union rather than conflict resolution, because a solved
 * result is immutable: INSERT ... ON CONFLICT DO UPDATE only ever accepts a
 * strictly better attempt.
 */
app.post('/sync', requireAuth, async (c) => {
  const claims = c.get('claims');
  const { results = [], since = 0 } = await c.req.json<{
    results?: {
      game: string;
      puzzle: string;
      mode: 'daily' | 'level';
      solved: boolean;
      ms: number;
      moves: number;
      hints: number;
      difficulty: number;
      finishedAt: number;
    }[];
    since?: number;
  }>();

  if (results.length > 500) return c.json({ error: 'too many results at once' }, 413);

  const stamp = now();
  if (results.length > 0) {
    await c.env.DB.batch(
      results.map((r) =>
        c.env.DB.prepare(
          `INSERT INTO results (user_id, game, puzzle, mode, solved, ms, moves, hints, difficulty, finished_at, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, game, puzzle) DO UPDATE SET
             solved = MAX(results.solved, excluded.solved),
             ms = CASE WHEN excluded.solved = 1 AND (results.solved = 0 OR excluded.ms < results.ms)
                       THEN excluded.ms ELSE results.ms END,
             moves = CASE WHEN excluded.solved = 1 AND (results.solved = 0 OR excluded.ms < results.ms)
                       THEN excluded.moves ELSE results.moves END,
             hints = MIN(results.hints, excluded.hints),
             synced_at = excluded.synced_at`,
        ).bind(
          claims.sub,
          r.game,
          r.puzzle,
          r.mode ?? 'daily',
          r.solved ? 1 : 0,
          r.ms,
          r.moves,
          r.hints,
          r.difficulty,
          r.finishedAt,
          stamp,
        ),
      ),
    );
  }

  const { results: rows } = await c.env.DB.prepare(
    `SELECT game, puzzle, mode, solved, ms, moves, hints, difficulty, finished_at as finishedAt
     FROM results WHERE user_id = ? AND synced_at > ? ORDER BY finished_at DESC LIMIT 2000`,
  )
    .bind(claims.sub, since)
    .all<Record<string, number | string>>();

  return c.json({
    results: rows.map((r) => ({ ...r, solved: r.solved === 1 })),
    now: stamp,
  });
});

/* ------------------------------------------------------------- boards */

/** `:puzzle` is an ISO date for a daily board, a level id for a level board. */
app.get('/boards/:game/:puzzle', async (c) => {
  const game = c.req.param('game');
  const puzzle = c.req.param('puzzle');

  const header = c.req.header('authorization') ?? '';
  const claims = header.startsWith('Bearer ')
    ? await verify(header.slice(7), c.env.TOKEN_SECRET)
    : null;

  // Assisted solves are ranked separately rather than hidden — using a nudge
  // shouldn't mean your time vanishes, it just isn't the same contest.
  const { results: rows } = await c.env.DB.prepare(
    `SELECT r.user_id as userId, COALESCE(u.display_name, 'anonymous') as displayName, r.ms, r.moves
     FROM results r JOIN users u ON u.id = r.user_id
     WHERE r.game = ? AND r.puzzle = ? AND r.solved = 1 AND r.hints = 0
     ORDER BY r.ms ASC LIMIT 100`,
  )
    .bind(game, puzzle)
    .all<{ userId: string; displayName: string; ms: number; moves: number }>();

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) as n FROM results WHERE game = ? AND puzzle = ? AND solved = 1',
  )
    .bind(game, puzzle)
    .first<{ n: number }>();

  const entries = rows.map((r, i) => ({
    rank: i + 1,
    displayName: r.displayName,
    ms: r.ms,
    moves: r.moves,
    isYou: claims?.sub === r.userId,
  }));

  // Cached at the edge: a top-100 does not need to be accurate to the second,
  // and this is the only route that could ever get hot.
  c.header('cache-control', 'public, max-age=60');
  return c.json({ entries, total: total?.n ?? 0 });
});

/* ---------------------------------------------------------------- me */

app.get('/me/export', requireAuth, async (c) => {
  const claims = c.get('claims');
  const user = await c.env.DB.prepare(
    'SELECT id, display_name as displayName, email, tier, created_at as createdAt FROM users WHERE id = ?',
  )
    .bind(claims.sub)
    .first();
  const { results } = await c.env.DB.prepare(
    'SELECT game, puzzle, mode, solved, ms, moves, hints, difficulty, finished_at as finishedAt FROM results WHERE user_id = ?',
  )
    .bind(claims.sub)
    .all();

  c.header('content-disposition', 'attachment; filename="sussed-export.json"');
  return c.json({ identity: user, results });
});

/** Delete means delete. One cascade, no shadow copy, no soft-delete flag. */
app.delete('/me', requireAuth, async (c) => {
  const claims = c.get('claims');
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(claims.sub).run();
  return c.json({ deleted: true });
});

app.get('/health', (c) => c.json({ ok: true }));

export default app;
