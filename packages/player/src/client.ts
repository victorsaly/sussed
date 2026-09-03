/**
 * The wire. Everything that talks to the players service lives here.
 *
 * Every method is allowed to fail. The caller's job is to carry on regardless —
 * a game that breaks when the network does has failed at its one job.
 */

import type { PlayResult } from '@sussed/core';
import type { Identity, LeaderboardEntry } from './types';

export interface ClientOptions {
  /** e.g. https://api.sussed.games */
  baseUrl: string;
  /** game slug, sent as the tenant on every call */
  game: string;
  fetchImpl?: typeof fetch;
}

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export class PlayersClient {
  private readonly base: string;
  private readonly game: string;
  private readonly f: typeof fetch;

  constructor(opts: ClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, '');
    this.game = opts.game;
    this.f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const { token, ...rest } = init;
    const res = await this.f(`${this.base}${path}`, {
      ...rest,
      headers: {
        'content-type': 'application/json',
        'x-sussed-game': this.game,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(rest.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new ServiceError(await res.text().catch(() => res.statusText), res.status);
    }
    return (await res.json()) as T;
  }

  /** Exchange a local device id for a token. No personal data involved. */
  anonymous(deviceId: string): Promise<{ token: string; expiresAt: number; userId: string }> {
    return this.call('/auth/anonymous', {
      method: 'POST',
      body: JSON.stringify({ deviceId }),
    });
  }

  /** Step one of claiming: ask the server for a passkey registration challenge. */
  passkeyOptions(token: string, displayName: string): Promise<{ options: unknown; sessionId: string }> {
    return this.call('/auth/passkey/options', {
      method: 'POST',
      token,
      body: JSON.stringify({ displayName }),
    });
  }

  /** Step two: hand back what the authenticator produced. Binds the device id. */
  passkeyVerify(
    token: string,
    sessionId: string,
    credential: unknown,
  ): Promise<{ token: string; expiresAt: number; userId: string; displayName: string }> {
    return this.call('/auth/passkey/verify', {
      method: 'POST',
      token,
      body: JSON.stringify({ sessionId, credential }),
    });
  }

  /** Fallback for devices without a passkey: emailed one-time link. */
  requestMagicLink(token: string, email: string, displayName: string): Promise<{ sent: true }> {
    return this.call('/auth/magic/request', {
      method: 'POST',
      token,
      body: JSON.stringify({ email, displayName }),
    });
  }

  verifyMagicLink(code: string, deviceId: string): Promise<{
    token: string;
    expiresAt: number;
    userId: string;
    displayName: string;
  }> {
    return this.call('/auth/magic/verify', {
      method: 'POST',
      body: JSON.stringify({ code, deviceId }),
    });
  }

  /**
   * One round trip: push what we have, pull what we're missing. Called on
   * load, on visibility change, and after a solve — never on a move.
   */
  sync(token: string, results: PlayResult[], since?: number): Promise<{ results: PlayResult[]; now: number }> {
    return this.call('/sync', {
      method: 'POST',
      token,
      body: JSON.stringify({ results, since: since ?? 0 }),
    });
  }

  /** `puzzle` is an ISO date for a daily board, a level id for a level board. */
  leaderboard(
    token: string | undefined,
    puzzle: string,
  ): Promise<{ entries: LeaderboardEntry[]; total: number }> {
    return this.call(`/boards/${this.game}/${encodeURIComponent(puzzle)}`, { method: 'GET', token });
  }

  /** GDPR, and also just decency. Both are one call. */
  exportData(token: string): Promise<{ identity: Identity; results: PlayResult[] }> {
    return this.call('/me/export', { method: 'GET', token });
  }

  deleteAccount(token: string): Promise<{ deleted: true }> {
    return this.call('/me', { method: 'DELETE', token });
  }
}
