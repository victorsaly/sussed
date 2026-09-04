# SUSSED

A studio of small, quiet daily puzzle games. One monorepo, nine planned games,
no server in the play loop.

```bash
corepack enable            # gets you pnpm
pnpm install
pnpm generate              # build a year of Bridges puzzles
pnpm verify                # re-solve every one of them — the CI gate
pnpm dev                   # play Bridges at http://localhost:5173
pnpm dev:twostars          # Two Stars at http://localhost:5174
pnpm dev:loop              # Loop at http://localhost:5175
```

`pnpm dev` runs entirely offline. Set `VITE_SYNC=false` in `games/bridges/.env`
if you want to be certain nothing tries to reach the players service.

## What's here

| | |
|---|---|
| `packages/core` | Seeded RNG, the daily calendar, the move stack, shared types |
| `packages/player` | Identity, local storage, sync, streaks and stats — the platform |
| `packages/share` | The share card. Text first, image second |
| `packages/ui` | Theme tokens and the chrome every game shares |
| `packages/pwa` | Service worker, install prompt, manifest builder |
| `games/bridges` | The first game: rules, solver, generator, course, board |
| `games/twostars` | The second: Star Battle. Same files, everything else shared |
| `games/loop` | The third: Slitherlink. One closed loop from the edge counts |
| `services/players` | One Cloudflare Worker serving all nine games |
| `tools/verify.ts` | Re-solves every shipped puzzle. CI fails if any is ambiguous |

## How a game works

1. `generate.ts` runs in CI, builds a year of puzzles, and writes
   `public/puzzles.json`. The solver proves each has exactly one answer.
2. The React app imports that file directly, so the first paint is a playable
   board. There is no loading state anywhere in the game.
3. Every move writes to IndexedDB and returns immediately.
4. After a solve, the result is recorded locally, then pushed to the players
   service in the background. If that fails, nothing visible happens.

## The players service

Identity, synced history and leaderboards for every game, from one deployment.

```bash
cd services/players
wrangler d1 create sussed                      # put the id in wrangler.toml
pnpm db:local                                  # apply schema.sql
wrangler secret put TOKEN_SECRET               # openssl rand -base64 48
pnpm dev
```

Without `RESEND_API_KEY`, magic links are logged to the console instead of
emailed — enough to develop the whole flow with no mail provider.

Sign-in is passkeys first, emailed link as fallback. There are no passwords in
this system, so there is no reset flow and no hash to get wrong.

## Deploying a game

Static build, so any host works.

```bash
pnpm --filter @sussed/bridges build            # -> games/bridges/dist
```

Point the game's own domain at it. Add that origin to `ALLOWED_ORIGINS` in
`services/players/wrangler.toml`.

## Costs

Nine games as PWAs, with the shared service: roughly £80/year, almost all of
which is domain registration. The Workers free tier covers 100k requests/day
and, because games sync a handful of times per session rather than per move,
that's around 10–20k daily players across the whole studio before it costs
anything.

## Adding the next game

Copy `games/bridges`. Replace four files — `engine.ts`, `solver.ts`,
`generate.ts`, and the board component. Identity, streaks, sync, sheets, the
share card, the PWA shell and the theme all come from the packages unchanged.

`docs/handoff.md` is the state of play — what works, what has never been run,
and what to do next. `CLAUDE.md` holds the invariants. `docs/project-brief.md`
holds the studio brief and the full game slate.
