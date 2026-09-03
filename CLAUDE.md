# SUSSED — working notes for Claude

Read this before changing anything. It is the short version of decisions that
were argued out already; if a change contradicts one of these, say so rather
than quietly working around it.

## What this is

A studio of small daily puzzle games. Nine planned, one built. Each game gets
its own keyword domain (bridgesdaily.com, twostars.com…) and links back to the
studio hub at sussed.games. Free, no ads, no paywall. Built for craft first —
revenue is a bonus, so nothing here should be traded away for it.

## The one rule everything else serves

**You land on the page and you are already playing.** No splash, no menu, no
tutorial modal, no sign-in wall, no spinner. The board is dealt on first paint.
Everything else — stats, archive, settings, rules, the account — is one layer
down, discovered by people who go looking.

If a change puts anything between arriving and playing, it is wrong.

## Architecture, in one paragraph

Puzzles are generated **at build time** by a Node script, verified by a solver
in CI, and shipped as a JSON file inside the bundle. No server touches a puzzle.
Games write every move to IndexedDB first and return instantly; the players
service is called a handful of times a session (load, focus, solve) and never on
a move. That is what makes the game work offline, load instantly, and fit inside
a free tier.

## The three identity tiers

1. **anonymous** — device id made locally on first load. Everything works.
   Nothing leaves the device. Most players stay here; that is a success.
2. **claimed / portable** — offered only *after* a result worth keeping, with a
   sentence about their actual situation ("you're 6 days in a row"), never
   "create an account".
3. Moving up a tier **never loses anything**. The server upgrades the existing
   user attached to the device id — it does not create a new one. Breaking this
   would be the single worst bug in the codebase.

## Invariants — do not break these

- **A generated puzzle has exactly one solution.** `pnpm verify` re-solves every
  shipped puzzle from scratch and CI fails if any is ambiguous. The generator
  does not get to mark its own homework.
- **Monday and Tuesday puzzles are solvable by pure deduction**, never guessing.
- **A solved result is immutable.** This is why sync is a set merge rather than
  conflict resolution. Guarded in `store.ts` and in the SQL upsert.
- **Game engines are plain TypeScript with zero React imports.** They must run
  in a Node build script.
- **Collect almost nothing.** A user id, a display name, an auth credential, one
  row per puzzle. No age, no location, no analytics profile. Every field not
  added is one that cannot leak.

## Layout

```
packages/core     seeded rng · daily calendar · move stack · shared types
packages/player   identity · local store · sync · stats     ← the platform
packages/share    the share card (text first, image second)
packages/ui       theme tokens + shared chrome
packages/pwa      service worker, install prompt, manifest
games/bridges     engine.ts (rules) · solver.ts · generate.ts · React board
services/players  one Cloudflare Worker for all nine games
tools/verify.ts   the CI gate
```

## Commands

```bash
pnpm install
pnpm generate          # writes games/bridges/public/puzzles.json
pnpm verify            # re-solves every puzzle; CI gate
pnpm dev               # play Bridges at localhost:5173
pnpm typecheck
pnpm service:dev       # wrangler dev for the players service
```

## Adding a game

Copy `games/bridges`, replace `engine.ts`, `solver.ts`, `generate.ts` and the
board component. Everything else — identity, streaks, sync, sheets, share card,
PWA, theme — comes from the packages unchanged. Add the new bundle path to
`tools/verify.ts`. If you find yourself copying something out of `games/bridges`
that is not one of those four files, it belongs in a package instead.

## Tone

Copy is written from the player's side of the screen. Specific beats clever.
"You're on a 6-day streak" not "Save your progress". Errors say what happened
and what to do. No exclamation marks, no emoji in UI copy except the streak
flame and the share card blocks.
