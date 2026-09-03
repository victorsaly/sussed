/**
 * @sussed/player — the platform every game imports.
 *
 * One object owns identity, the local record, sync and stats. A game asks it
 * two things: "who is this and what have they done" on load, and "here is a
 * result" on finish. Everything else is this package's problem.
 */

import { mergeResults, resultKey, toIsoDate, type PlayResult } from '@sussed/core';
import { PlayersClient, type ClientOptions } from './client';
import { createStorage } from './store';
import { claimPrompt, computeStats } from './stats';
import type { GameStats, Identity, LeaderboardEntry, PlayerStorage } from './types';

export * from './types';
export * from './stats';
export { PlayersClient, ServiceError } from './client';

export interface PlayerOptions extends ClientOptions {
  /** set false in dev to run entirely offline */
  sync?: boolean;
}

function newDeviceId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class Player {
  private storage!: PlayerStorage;
  private identity!: Identity;
  private readonly client: PlayersClient;
  private readonly game: string;
  private readonly syncEnabled: boolean;
  private lastSyncAt = 0;
  private listeners = new Set<() => void>();

  private constructor(opts: PlayerOptions) {
    this.client = new PlayersClient(opts);
    this.game = opts.game;
    this.syncEnabled = opts.sync !== false;
  }

  /**
   * Resolves as soon as local state is ready — never waits on the network.
   * Sync fires afterwards and notifies subscribers if anything changed.
   */
  static async create(opts: PlayerOptions): Promise<Player> {
    const player = new Player(opts);
    player.storage = await createStorage();
    const existing = await player.storage.getIdentity();
    player.identity = existing ?? { deviceId: newDeviceId(), tier: 'anonymous' };
    if (!existing) await player.storage.setIdentity(player.identity);
    void player.syncQuietly();
    return player;
  }

  get me(): Readonly<Identity> {
    return this.identity;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  async stats(game = this.game): Promise<GameStats> {
    return computeStats(await this.storage.getResults(game));
  }

  async resultFor(date: string, game = this.game): Promise<PlayResult | null> {
    const all = await this.storage.getResults(game);
    return all.find((r) => r.date === date) ?? null;
  }

  /**
   * Record an attempt. Writes locally and returns straight away; the push to
   * the server happens after, and its failure is not the player's problem.
   */
  async record(result: Omit<PlayResult, 'finishedAt' | 'game'> & { game?: string }): Promise<PlayResult> {
    const full: PlayResult = {
      game: result.game ?? this.game,
      date: result.date,
      solved: result.solved,
      ms: result.ms,
      moves: result.moves,
      hints: result.hints,
      difficulty: result.difficulty,
      finishedAt: Date.now(),
    };
    const stored = await this.storage.putResult(full);
    this.emit();
    void this.syncQuietly();
    return stored;
  }

  /** The T2 moment. Returns the exact sentence to show, or null for "not yet". */
  async claimOffer(justSolved: { ms: number; percentile?: number } | null): Promise<string | null> {
    if (this.identity.tier !== 'anonymous') return null;
    return claimPrompt(await this.stats(), justSolved);
  }

  private async ensureToken(): Promise<string | null> {
    if (!this.syncEnabled) return null;
    const fresh = this.identity.token && (this.identity.tokenExpiresAt ?? 0) > Date.now() + 60_000;
    if (fresh) return this.identity.token ?? null;
    try {
      const res = await this.client.anonymous(this.identity.deviceId);
      this.identity = {
        ...this.identity,
        userId: this.identity.userId ?? res.userId,
        token: res.token,
        tokenExpiresAt: res.expiresAt,
      };
      await this.storage.setIdentity(this.identity);
      return res.token;
    } catch {
      return null;
    }
  }

  /**
   * Claim the account with a passkey. The server binds it to the existing
   * device id, so nothing already played is lost. That is the whole point.
   */
  async claimWithPasskey(displayName: string): Promise<boolean> {
    const token = await this.ensureToken();
    if (!token) return false;
    try {
      const { options, sessionId } = await this.client.passkeyOptions(token, displayName);
      const credential = await navigator.credentials.create({
        publicKey: options as PublicKeyCredentialCreationOptions,
      });
      if (!credential) return false;
      const res = await this.client.passkeyVerify(token, sessionId, credential);
      this.identity = {
        ...this.identity,
        tier: 'portable',
        userId: res.userId,
        displayName: res.displayName,
        token: res.token,
        tokenExpiresAt: res.expiresAt,
      };
      await this.storage.setIdentity(this.identity);
      this.emit();
      void this.syncQuietly();
      return true;
    } catch {
      return false;
    }
  }

  async claimWithEmail(email: string, displayName: string): Promise<boolean> {
    const token = await this.ensureToken();
    if (!token) return false;
    try {
      await this.client.requestMagicLink(token, email, displayName);
      return true;
    } catch {
      return false;
    }
  }

  /** Called by the page the magic link lands on. */
  async completeEmailClaim(code: string): Promise<boolean> {
    try {
      const res = await this.client.verifyMagicLink(code, this.identity.deviceId);
      this.identity = {
        ...this.identity,
        tier: 'portable',
        userId: res.userId,
        displayName: res.displayName,
        token: res.token,
        tokenExpiresAt: res.expiresAt,
      };
      await this.storage.setIdentity(this.identity);
      this.emit();
      void this.syncQuietly();
      return true;
    } catch {
      return false;
    }
  }

  async leaderboard(date = toIsoDate()): Promise<LeaderboardEntry[]> {
    const token = await this.ensureToken();
    if (!token) return [];
    try {
      const { entries } = await this.client.leaderboard(token, date);
      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Push unsynced results, pull anything this device is missing, merge.
   * Merging is a set union because a solved result is immutable — the hard
   * part of offline sync was designed away in the schema.
   */
  async syncQuietly(): Promise<void> {
    if (!this.syncEnabled) return;
    const token = await this.ensureToken();
    if (!token) return;
    try {
      const pending = await this.storage.getUnsynced();
      const { results: remote, now } = await this.client.sync(token, pending, this.lastSyncAt);
      this.lastSyncAt = now;
      await this.storage.markSynced(pending.map(resultKey));

      let changed = pending.length > 0;
      for (const incoming of remote) {
        const mine = await this.resultFor(incoming.date, incoming.game);
        const winner = mine ? mergeResults(mine, incoming) : incoming;
        if (!mine || winner !== mine) {
          await this.storage.putResult(winner);
          changed = true;
        }
      }
      if (changed) this.emit();
    } catch {
      /* offline, or the service is down. Try again next time. */
    }
  }

  async exportEverything(): Promise<{ identity: Identity; results: PlayResult[] }> {
    return { identity: this.identity, results: await this.storage.getResults() };
  }

  async deleteEverything(): Promise<void> {
    const token = this.identity.token;
    if (token && this.identity.tier !== 'anonymous') {
      await this.client.deleteAccount(token).catch(() => undefined);
    }
    await this.storage.clear();
    this.identity = { deviceId: newDeviceId(), tier: 'anonymous' };
    await this.storage.setIdentity(this.identity);
    this.emit();
  }
}
