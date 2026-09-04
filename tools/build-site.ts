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
 * That sub-path is the only awkward part, and it is why the manifests, the
 * service worker scope and the icon links are all base-relative. When a real
 * domain arrives the same build runs with SITE_BASE=/ and every one of those
 * paths is already correct.
 *
 *   pnpm site                      → _site, rooted at /
 *   SITE_BASE=/sussed/ pnpm site   → _site, rooted at /sussed/ (a project page)
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameLogo, type GameId } from '../packages/ui/src/GameLogo';

interface Entry {
  /** the directory under games/, and the sub-path it is served from */
  slug: string;
  /** the studio-wide id: picks the mark and the hue, and is not always the slug */
  id: GameId;
  name: string;
  tagline: string;
  /** the one thing a stranger has to understand to make their first move */
  rule: string;
  status: 'launching' | 'built';
}

/* Order is the launch order, not the build order. Arrows leads because it is
   the only one a stranger can play without reading a sentence; Loop is last
   because it is the best puzzle here and the coldest start on the slate. */
const GAMES: Entry[] = [
  {
    slug: 'arrows',
    id: 'arrows',
    name: 'Arrows Out',
    tagline: 'Thread every path off the board.',
    rule: 'Tap a path and it threads out, head first — if the run from its arrowhead is clear.',
    status: 'launching',
  },
  {
    slug: 'bridges',
    id: 'bridges',
    name: 'Bridges',
    tagline: 'Join the islands into one network.',
    rule: "Each island's number is exactly how many bridges must touch it. Nothing crosses.",
    status: 'built',
  },
  {
    slug: 'twostars',
    id: 'starbattle',
    name: 'Two Stars',
    tagline: 'Two stars in every row, column and region.',
    rule: 'No two stars may touch, not even at a corner.',
    status: 'built',
  },
  {
    slug: 'loop',
    id: 'slitherlink',
    name: 'Loop',
    tagline: 'One closed loop, drawn from the numbers alone.',
    rule: 'Each number says how many of its four sides the loop uses.',
    status: 'built',
  },
];

const base = process.env.SITE_BASE ?? '/';
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, '_site');

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * One card. The mark comes from the same component the game's own header
 * renders, so it cannot drift from the game it points at.
 */
function card(game: Entry): string {
  const mark = renderToStaticMarkup(createElement(GameLogo, { game: game.id, title: '' }));
  const flag = game.status === 'launching' ? ' <em>first</em>' : '';
  return `        <a class="game" data-game="${game.id}" href="${base}${game.slug}/">
          <span class="mark" aria-hidden="true">${mark}</span>
          <span class="body">
            <span class="name">${escape(game.name)}${flag}</span>
            <span class="tagline">${escape(game.tagline)}</span>
            <span class="rule">${escape(game.rule)}</span>
          </span>
        </a>`;
}

function hub(): string {
  const template = readFileSync(resolve(root, 'sites/hub/index.html'), 'utf8');
  return template
    .replace('<!--GAMES-->', `\n${GAMES.map(card).join('\n')}\n      `)
    .replaceAll('{{base}}', base);
}

function main(): void {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const game of GAMES) {
    const dir = resolve(root, 'games', game.slug);
    console.log(`· ${game.slug} → ${base}${game.slug}/`);
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
