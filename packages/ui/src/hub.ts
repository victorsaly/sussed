/**
 * Where the studio lives, from where this game is served.
 *
 * The games are staged side by side under one host today — /sussed/arrows/ —
 * and will each have their own domain later, at which point the hub is a
 * different site entirely rather than a parent directory. One helper so that
 * the day the domains arrive, no game has a hard-coded link pointing at a path
 * that no longer exists.
 *
 * `base` is the game's own base path; pass `import.meta.env.BASE_URL`. Taking
 * it as an argument rather than reading it here keeps this package free of a
 * dependency on Vite's ambient types.
 */
export const STUDIO_URL = 'https://sussed.games';

export function hubHref(base: string): string {
  // '/sussed/arrows/' → '/sussed/'. A game at the root of its own domain has
  // no parent to go to, so it goes to the studio.
  const parent = base.replace(/[^/]+\/$/, '');
  return parent === '' || parent === '/' ? STUDIO_URL : parent;
}
