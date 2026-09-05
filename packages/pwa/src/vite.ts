/**
 * The build step that actually ships the service worker.
 *
 * `sw.ts` next door has existed since the first commit and was never compiled
 * by anything. Every game called `registerServiceWorker()`, every request for
 * `sw.js` returned a 404, and the failure went into a `.catch(() => undefined)`
 * and disappeared. So nothing was ever cached, nothing worked on a plane, and
 * four index.html files and the studio hub all said "works offline" — which is
 * the part that made it worth fixing rather than deleting.
 *
 * It is a plugin in this package rather than four copies of a build script,
 * for the same reason everything else here is: the fifth game should inherit
 * it without knowing it exists.
 *
 * A service worker cannot be an ordinary Vite entry. It has to land at one
 * fixed, unhashed URL, and it must be a self-contained classic script rather
 * than an ES module with imports — so it is bundled separately with esbuild
 * (which Vite already carries) once the main bundle is written.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';

export function serviceWorker(): Plugin {
  let config: ResolvedConfig;

  return {
    name: 'sussed:service-worker',
    // Only on build: in dev a stale worker caching the shell is a menace.
    apply: 'build',

    configResolved(resolved) {
      config = resolved;
    },

    async closeBundle() {
      // Vite's own build, not esbuild directly: esbuild is a transitive
      // dependency and pnpm does not expose it to the games, whereas every
      // game already depends on Vite. Imported inside the hook so that merely
      // listing this plugin in a config costs nothing.
      const { build } = await import('vite');
      const here = dirname(fileURLToPath(import.meta.url));

      await build({
        // configFile:false is load-bearing — without it this nested build
        // reads the game's config, finds this plugin, and recurses.
        configFile: false,
        logLevel: 'warn',
        define: {
          // The worker fetches nothing by absolute path, so it needs no idea
          // where the game is served from. This names the cache, which must
          // differ per game: while the games are staged side by side on one
          // host, a shared name means four workers evicting each other.
          __SW_SCOPE__: JSON.stringify(config.base),
          // Changes every build, so a deploy retires the previous shell cache
          // instead of leaving a returning player pinned to files that the new
          // build replaced.
          __SW_BUILD__: JSON.stringify(Date.now().toString(36)),
        },
        build: {
          outDir: resolve(config.root, config.build.outDir),
          emptyOutDir: false,
          target: 'es2022',
          minify: config.build.minify !== false,
          lib: {
            entry: resolve(here, 'sw.ts'),
            // A worker must be a self-contained classic script at one fixed,
            // unhashed URL — not an ES module, and not something with a hash
            // in its name that the registration could not predict.
            formats: ['iife'],
            name: 'sussedServiceWorker',
            fileName: () => 'sw.js',
          },
        },
      });
    },
  };
}
