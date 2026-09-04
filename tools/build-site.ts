/**
 * Builds every game plus the hub into one `_site/` tree, for GitHub Pages.
 *
 * This is staging, not the plan. The plan is one keyword domain per game —
 * arrowsout.com, bridgesdaily.com — with the studio hub at sussed.games. But a
 * game nobody can open is a game nobody can test, and Pages costs nothing and
 * needs no DNS, so until the domains are bought everything is stacked under a
 * single host:
 *
 *   /            the hub
 *   /arrows/     each game at its own sub-path
 *   /bridges/    …
 *
 * That sub-path is the only thing that makes this awkward, and it is why the
 * manifests, the service worker and the icon links are all base-relative. When
 * a real domain arrives, the same build runs with SITE_BASE=/ and every one of
 * those paths is already correct.
 *
 *   pnpm site                      → _site, rooted at /
 *   SITE_BASE=/sussed/ pnpm site   → _site, rooted at /sussed/ (a project page)
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Entry {
  slug: string;
  name: string;
  tagline: string;
  /** the one thing a stranger has to understand to make their first move */
  rule: string;
  status: 'launching' | 'built';
  mark: string;
}

/* Order is the launch order, not the build order. Arrows leads because it is
   the only one a stranger can play without reading a sentence; Loop is last
   because it is the best puzzle here and the coldest start on the slate. */
const GAMES: Entry[] = [
  {
    slug: 'arrows',
    name: 'Arrows Out',
    tagline: 'Thread every path off the board.',
    rule: 'Tap a path and it threads out, head first — if the run from its arrowhead is clear.',
    status: 'launching',
    mark: `<path d="M12 38V26H30" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".45"/><path d="M42 26L32 20V32Z" fill="currentColor"/>`,
  },
  {
    slug: 'bridges',
    name: 'Bridges',
    tagline: 'Join the islands into one network.',
    rule: "Each island's number is exactly how many bridges must touch it. Nothing crosses.",
    status: 'built',
    mark: `<g stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M17 21H31M17 27H31"/></g><circle cx="13" cy="24" r="7" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="35" cy="24" r="7" fill="none" stroke="currentColor" stroke-width="3"/>`,
  },
  {
    slug: 'twostars',
    name: 'Two Stars',
    tagline: 'Two stars in every row, column and region.',
    rule: 'No two stars may touch, not even at a corner.',
    status: 'built',
    mark: `<path d="M16 12l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/><path d="M33 25l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor" opacity=".45"/>`,
  },
  {
    slug: 'loop',
    name: 'Loop',
    tagline: 'One closed loop, from the numbers alone.',
    rule: 'Each number says how many of its four sides the loop uses.',
    status: 'built',
    mark: `<path d="M10 10H26V26H38V38H10Z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/>`,
  },
];

const base = process.env.SITE_BASE ?? '/';
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, '_site');

function hub(): string {
  const cards = GAMES.map(
    (g) => `      <a class="game" href="${base}${g.slug}/">
        <span class="mark" aria-hidden="true"><svg viewBox="0 0 48 48">${g.mark}</svg></span>
        <span class="body">
          <span class="name">${g.name}${g.status === 'launching' ? ' <em>first</em>' : ''}</span>
          <span class="tagline">${g.tagline}</span>
          <span class="rule">${g.rule}</span>
        </span>
      </a>`,
  ).join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>SUSSED — small daily puzzles</title>
    <meta name="description" content="A studio of small daily puzzle games. Free, no ads, no sign-up, works offline." />
    <meta name="theme-color" content="#f2f0ec" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0e0f12" media="(prefers-color-scheme: dark)" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=JetBrains+Mono:wght@400;600&display=swap" />
    <style>
      :root {
        --bg: #f2f0ec; --surface: #fff; --ink: #17171a; --ink-2: #5f6068; --ink-3: #91929b;
        --rule: #d8d5cf; --accent: #b4472f;
        --display: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
        --mono: 'JetBrains Mono', ui-monospace, Menlo, monospace;
        color-scheme: light dark;
      }
      @media (prefers-color-scheme: dark) {
        :root:not([data-theme='light']) {
          --bg: #0e0f12; --surface: #17191e; --ink: #e9eaee; --ink-2: #a0a3ac; --ink-3: #6d707a;
          --rule: #292c33; --accent: #ec6a4e;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0; background: var(--bg); color: var(--ink);
        font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .wrap { max-width: 640px; margin: 0 auto; padding: 48px 20px 64px; }
      h1 {
        font-family: var(--display); font-weight: 800; font-size: clamp(34px, 9vw, 52px);
        letter-spacing: -0.03em; margin: 0 0 10px;
      }
      .standfirst { margin: 0 0 8px; font-size: 18px; color: var(--ink-2); max-width: 34ch; }
      .terms {
        font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
        color: var(--ink-3); margin: 0 0 32px;
      }
      .games { display: grid; gap: 10px; }
      .game {
        display: flex; gap: 16px; align-items: flex-start;
        background: var(--surface); border: 1px solid var(--rule);
        padding: 16px 18px; text-decoration: none; color: inherit;
      }
      .game:hover, .game:focus-visible { border-color: var(--accent); outline: none; }
      .mark { color: var(--accent); flex: none; }
      .mark svg { width: 34px; height: 34px; display: block; }
      .body { display: grid; gap: 2px; }
      .name { font-family: var(--display); font-weight: 700; font-size: 18px; letter-spacing: -0.015em; }
      .name em {
        font-family: var(--mono); font-style: normal; font-size: 10px; letter-spacing: 0.1em;
        text-transform: uppercase; color: var(--accent); vertical-align: 2px; margin-left: 6px;
      }
      .tagline { color: var(--ink-2); font-size: 15px; }
      .rule { color: var(--ink-3); font-size: 13.5px; }
      footer {
        margin-top: 36px; padding-top: 18px; border-top: 1px solid var(--rule);
        font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em;
        text-transform: uppercase; color: var(--ink-3);
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>SUSSED</h1>
      <p class="standfirst">Small daily puzzles. You land on the board and you are already playing.</p>
      <p class="terms">Free · No ads · No sign-up · Works offline</p>
      <div class="games">
${cards}
      </div>
      <footer>Staging build · each game gets its own domain</footer>
    </div>
  </body>
</html>
`;
}

function main(): void {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const game of GAMES) {
    const dir = resolve(root, 'games', game.slug);
    console.log(`· building ${game.slug} at ${base}${game.slug}/`);
    execFileSync('npx', ['vite', 'build', '--base', `${base}${game.slug}/`], {
      cwd: dir,
      stdio: 'inherit',
    });
    cpSync(resolve(dir, 'dist'), resolve(out, game.slug), { recursive: true });
  }

  writeFileSync(resolve(out, 'index.html'), hub());
  // Without this, Pages runs Jekyll and drops anything starting with an underscore.
  writeFileSync(resolve(out, '.nojekyll'), '');
  console.log(`\n✓ _site ready — hub plus ${GAMES.length} games, rooted at ${base}`);
}

main();
