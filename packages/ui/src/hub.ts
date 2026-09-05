/**
 * Where the studio lives, worked out from where this game is served.
 *
 * While the games are staged side by side under one host — /sussed/arrows/ —
 * the hub is simply the parent directory, and that needs no configuration at
 * all. The fallback below is for a game served from the root of somewhere,
 * which has no parent to go to.
 *
 * `base` is the game's own base path; pass `import.meta.env.BASE_URL`. Taking
 * it as an argument rather than reading it here keeps this package free of a
 * dependency on Vite's ambient types.
 */

/**
 * The fallback, and it is deliberately the GitHub Pages hub rather than
 * sussed.games.
 *
 * sussed.games is not bought yet. Pointing at it would be a link to nothing —
 * which is what it was, in local dev and in any root-served build. A home
 * button that goes nowhere is worse than no home button, so this points at the
 * hub that actually exists today.
 *
 * CHANGE THIS ONE LINE the day the domain is live. Nothing else needs to move:
 * every game works its own way home from its base path, so none of them
 * carries a hard-coded studio address.
 */
export const STUDIO_URL = 'https://victorsaly.github.io/sussed/';

export function hubHref(base: string): string {
  // '/sussed/arrows/' → '/sussed/'. A game at the root of its own domain has
  // no parent, so it goes to wherever the studio currently lives.
  const parent = base.replace(/[^/]+\/$/, '');
  return parent === '' || parent === '/' ? STUDIO_URL : parent;
}

/**
 * The absolute address of this game, for the share card.
 *
 * Worked out at runtime from where the page is actually being served, which is
 * the only answer that cannot go stale. Each game used to carry its own
 * keyword domain as a constant — arrowsout.com, bridgesdaily.com — and none of
 * those are bought, so every share posted a dead link to whoever received it.
 * That is the one link in the studio that reaches people who have never been
 * here, so it is the last one that should be wrong.
 *
 * On a staged build this returns the Pages URL for the game; the day a keyword
 * domain is live and serving the same build, it returns that instead, with
 * nothing to change.
 */
export function gameHref(base: string): string {
  if (typeof location === 'undefined') return STUDIO_URL;
  return new URL(base, location.origin).href;
}
