# SUSSED — working notes for Claude

**New session? Read `docs/handoff.md` first** — state of play, what is verified,
what has never been run, and what to do next. Then this file for the rules.

`docs/` is deliberately not in the repository. It holds the studio brief, the
full game slate, and the domain and money decisions, and this repo is public.
It lives only on Victor's machine, so a fresh clone will not have it — work
from this file, and say so rather than inventing what the handoff would have
said.

Read this before changing anything. It is the short version of decisions that
were argued out already; if a change contradicts one of these, say so rather
than quietly working around it.

## What this is

A studio of small daily puzzle games. Nine planned, three built (Bridges, Two Stars, Loop). Each game gets
its own keyword domain (bridgesdaily.com, twostars.com…) and links back to the
studio hub at sussed.games. Free, no ads, no paywall. Built for craft first —
revenue is a bonus, so nothing here should be traded away for it.

## The one rule everything else serves

**You land on the page and you are already playing.** No splash, no menu, no
tutorial modal, no sign-in wall, no spinner. The board is dealt on first paint.
Everything else — stats, archive, settings, rules, the account — is one layer
down, discovered by people who go looking.

If a change puts anything between arriving and playing, it is wrong.

## What ships first, and why

Four games now exist: **bridges**, **twostars**, **loop**, **arrows**. Existing
is not the same as launching, and the order is a decision, not a preference.

**Arrows Out launches first.** It is the only one that passes the five-second
test: hand someone the phone with the board open and say nothing, and an arrow
is a drawn instruction they already understand. Every other game needs at least
a sentence, and a stranger arriving from a link will not read one.

**Loop (Slitherlink) launches last, and that is deliberate.** It is the best
puzzle here and the coldest start on the whole slate — a grid of scattered
numbers with no drawn goal. It was ranked ninth of nine for exactly this reason.
Building it early was fine; launching it early would not be. It goes out once
other games are sending it players who already trust the studio, at which point
its solver becomes the thing worth open-sourcing and writing about.

So: build in whatever order is interesting, but **launch legible-first**. If a
session proposes leading with a deduction game, that contradicts a decision that
was reasoned through, and it should say so out loud rather than quietly reorder.


## Prove the mechanic before building the UI

Write the solver first and measure the game with it. A mechanic that does not
survive that measurement will not survive players, and finding out costs hours
now against weeks after a launch.

The worked example is Arrows Out. The original rule — tap an arrow, it slides
until blocked, and leaves if it reaches the edge — turned out to have no puzzle
in it. Across 400 random boards, every solvable board could be cleared by
tapping whatever moved, in any order, and par always equalled the arrow count.

The cause is structural and worth carrying to the next game: **a game whose
only action removes pieces is confluent.** Taking a piece off the board never
makes anything harder, so if a solution exists at all, greedy finds it. Adding
walls did not help — it only made boards unsolvable.

The fix was to add an action that can be spent badly: tapping a blocked arrow
turns it 90°, so a wrong turn costs a tap. Note what the fix preserves — no
board can become unsolvable, because an arrow can always be turned back. Aim
for that shape: a real cost to think about, and no way to be stranded.

The story has a third act, decided 2026-09-04. Rotation fixed the measurement,
but the phone test that followed found the game: **paths, not tiles**. Each
arrowhead now leads a multi-cell path that threads out of the board head
first, and it can leave only when the straight run from its head is clear.
Tapping a blocked path costs a miss. This accepts confluence instead of
fighting it — order never matters, greedy always clears — because on a board
80% full the puzzle moved: the work is *seeing* which head is free. The cost
spent badly is the miss; the no-stranding guarantee is the generator's reverse
construction, which only lays a path on cells whose exit ray is clear at
placement, so the board always comes apart. The tap-to-turn engine stays in
git history if a planning game is ever wanted.


## Architecture, in one paragraph

Puzzles are generated **at build time** by a Node script, verified by a solver
in CI, and shipped as a JSON file inside the bundle. No server touches a puzzle.
Games write every move to IndexedDB first and return instantly; the players
service is called a handful of times a session (load, focus, solve) and never on
a move. That is what makes the game work offline, load instantly, and fit inside
a free tier.

## Levels are how a game teaches

Deduction games (Bridges, Slitherlink) fail the five-second test: a stranger
sees numbered circles and has no visible goal. Spatial games (Arrows Out, Six
Faces, Push Par) pass it — an arrow is a drawn instruction. So:

- **Level one cannot be failed.** Three pieces, every legal move correct. It
  exists to produce a success in the first five seconds, not to be a puzzle.
- **One new rule per chapter**, on a board simple enough that the rule is the
  only thing happening. That is the tutorial. There is no modal.
- **The daily unlocks after ten levels** (`dailyUnlocked()`), because a daily
  shown to a stranger is a hard puzzle with no context.
- **Failure must be visible** — the bump, the shake. A move that silently does
  nothing teaches nothing.

## Hints: a nudge before an answer

`packages/player/hints.ts` owns the ladder, and it is game-agnostic — a game
supplies a `HintSource`, nothing in that file knows what a bridge is.

1. **where to look** — pulses the piece that already determines something
2. **why** — one sentence, concrete, in the player's words
3. **what follows** — the next few forced moves as numbered arrows, in the
   order you'd find them, left for the player to actually play
4. **do it** — places the first one, then the ladder resets

Rung 3 is the one that matters; it shows reasoning travelling across the board
instead of handing over an isolated fact. Budget: free for the first five
course levels (a hint there IS the teaching), then 6, and 6/5/4 by daily
difficulty. Never remove the ✗ notation — without a way to record "definitely
not here", every ruled-out move has to live in the player's head, which is
where people give up on a board they could otherwise solve.

**The ladder ends in a flip.** Once the budget is spent, the board offers to
turn over and show the solution — a rung five, for the player who is stuck
past helping, not a button that sits next to a fresh board. Per game, the
`HintSource` supplies what "the solution" looks like: a deduction board flips
to its solved grid; a spatial game plays its solution as a replay off the move
stack, because its solved state is an empty board and a flip to nothing
teaches nothing. Two rules keep the flip honest. On a level, the player flips
back and still plays the moves themselves — the completion is a real result,
so progression stays derived. On a daily, flipping ends the attempt: revealed
is never recorded as solved.

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
- **Revealed is not solved.** The flip that shows a stuck player the answer
  never writes a solve. A revealed daily ends unrecorded; a revealed level
  still has to be played through. Streaks, stats and the share card only ever
  see real solves.
- **Monday and Tuesday puzzles are solvable by pure deduction**, never guessing.
- **A solved result is immutable.** This is why sync is a set merge rather than
  conflict resolution. Guarded in `store.ts` and in the SQL upsert.
- **Results are keyed by `(game, puzzle)`, not `(game, date)`.** `puzzle` is an
  ISO date for a daily and a level id for a level; `mode` tells them apart so
  streaks can ignore levels. Never narrow this back — a level-based game and a
  daily one share one table, one sync path and one leaderboard because of it.
- **Level progress is derived, never stored.** `buildProgress()` recomputes it
  from the result set. A stored "furthest level" counter drifts the moment two
  devices disagree.
- **Game engines are plain TypeScript with zero React imports.** They must run
  in a Node build script.
- **Collect almost nothing.** A user id, a display name, an auth credential, one
  row per puzzle. No age, no location, no analytics profile. Every field not
  added is one that cannot leak.

## Layout

```
packages/core     seeded rng · daily calendar · move stack · shared types
packages/player   identity · local store · sync · stats · the hint ladder and
                  the flip                                  ← the platform
packages/share    the share card (text first, image second)
packages/ui       theme tokens · shared chrome · GameLogo · CourseDots
packages/pwa      service worker, install prompt, manifest
games/bridges     engine.ts (rules) · solver.ts · generate.ts · levels.ts · React board
games/twostars    same files — Star Battle, two stars per row/column/region
games/loop        same files — Slitherlink, one closed loop from edge counts
games/arrows      same files, plus construct.ts (reverse construction) and
                  hints.ts — Arrows Out, paths that thread off the board
sites/hub         the studio front door, a static page with a slot for the
                  game cards; the marks come from GameLogo, never copied
services/players  one Cloudflare Worker for all nine games
tools/verify.ts   the CI gate
tools/build-site.ts  every game plus the hub into _site/, for staging
tools/icons.py    one app-icon mark per game
```

The repository is public and `docs/` is not in it — see the note at the top.

## Commands

```bash
pnpm install
pnpm generate          # writes each game's public/puzzles.json
pnpm verify            # re-solves every puzzle; CI gate
pnpm dev               # play Bridges at localhost:5173
pnpm dev:twostars      # Two Stars at localhost:5174
pnpm dev:loop          # Loop at localhost:5175
pnpm dev:arrows        # Arrows Out at localhost:5176
pnpm typecheck
pnpm site              # hub + all four games into _site/ (SITE_BASE to re-root)
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
