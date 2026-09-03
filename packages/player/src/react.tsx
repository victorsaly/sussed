import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import { Player, type PlayerOptions } from './index';
import type { GameStats } from './types';

const PlayerContext = createContext<Player | null>(null);

export function PlayerProvider({
  options,
  children,
  fallback = null,
}: {
  options: PlayerOptions;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [player, setPlayer] = useState<Player | null>(null);

  useEffect(() => {
    let alive = true;
    void Player.create(options).then((p) => {
      if (alive) setPlayer(p);
    });
    return () => {
      alive = false;
    };
    // options is a literal at the call site; identity is by game + baseUrl
  }, [options.game, options.baseUrl]);

  // Local storage opens in a few milliseconds, so this is a flash at most —
  // never a spinner the player has to look at.
  if (!player) return createElement('div', null, fallback);
  return createElement(PlayerContext.Provider, { value: player }, children);
}

export function usePlayer(): Player {
  const p = useContext(PlayerContext);
  if (!p) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return p;
}

/** Re-renders when results or identity change. */
export function usePlayerStats(): GameStats | null {
  const player = usePlayer();
  const [stats, setStats] = useState<GameStats | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = (): void => {
      void player.stats().then((s) => {
        if (alive) setStats(s);
      });
    };
    refresh();
    const off = player.subscribe(refresh);
    return () => {
      alive = false;
      off();
    };
  }, [player]);

  return stats;
}

/** Syncs on tab focus — the cheapest way to keep two devices honest. */
export function useSyncOnFocus(): void {
  const player = usePlayer();
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void player.syncQuietly();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [player]);
}
