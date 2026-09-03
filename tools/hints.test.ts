/**
 * Guards the hint ladder and the ✗ notation.
 *
 * The bug class this exists to catch: a hint that repeats itself, a hint that
 * "tells" on the first press, or a ladder that hands over the answer without
 * the player ever seeing where to look. All three quietly ruin the game.
 */

import { readFileSync } from 'node:fs';
import { buildTopology, cycleEdge, isSolved, type BoardState, type Puzzle } from '../games/bridges/src/engine';
import { deductionChain, nextDeduction } from '../games/bridges/src/solver';
import { HintLadder, hintBudget, type HintSource, type HintStep } from '../packages/player/src/hints';

let fails = 0;
const ok = (name: string, cond: boolean): void => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}`);
  if (!cond) fails++;
};

const bundle = JSON.parse(readFileSync('games/bridges/public/puzzles.json', 'utf8')) as {
  puzzles: Puzzle[];
};
const puzzle = bundle.puzzles.find((p) => p.difficulty === 1)!;
const topo = buildTopology(puzzle);

/* ---- the ✗ cycle: none -> one -> two -> ruled out -> none --------------- */
let st: BoardState = { counts: new Array<number>(topo.edges.length).fill(0), marks: new Set() };
const seen: string[] = [];
for (let i = 0; i < 4; i++) {
  const next = cycleEdge(puzzle, topo, st, 0);
  if (!next) break;
  st = next;
  seen.push(st.marks.has(0) ? 'X' : String(st.counts[0] ?? 0));
}
ok('cycle is one, two, ruled out, clear', seen.join(' ') === '1 2 X 0');

/* ---- hints never repeat themselves ------------------------------------- */
let work: BoardState = { counts: new Array<number>(topo.edges.length).fill(0), marks: new Set() };
const applied = new Set<number>();
let steps = 0;
for (let i = 0; i < 200; i++) {
  const d = nextDeduction(puzzle, topo, work.counts, work.marks);
  if (!d) break;
  if (applied.has(d.edgeId)) {
    ok('hint repeated itself on edge ' + d.edgeId, false);
    break;
  }
  applied.add(d.edgeId);
  if (d.value === 0) {
    const marks = new Set(work.marks);
    marks.add(d.edgeId);
    work = { counts: work.counts, marks };
  } else {
    const counts = work.counts.slice();
    counts[d.edgeId] = d.value;
    work = { counts, marks: work.marks };
  }
  steps++;
}
ok('following every hint solves the board', isSolved(puzzle, topo, work.counts));
ok('and it took a sensible number of steps', steps > 0 && steps <= topo.edges.length);

/* ---- the chain is causal and distinct ---------------------------------- */
const fresh: BoardState = { counts: new Array<number>(topo.edges.length).fill(0), marks: new Set() };
const chain = deductionChain(puzzle, topo, fresh.counts, fresh.marks, 4);
ok('chain returns up to four moves', chain.length > 1 && chain.length <= 4);
ok('chain has no duplicates', new Set(chain.map((c) => c.edgeId)).size === chain.length);
ok('every chain step names an island to look at', chain.every((c) => c.island >= 0));

/* ---- the ladder: point, explain, chain, only then hand it over --------- */
const source: HintSource<number> = {
  next: () => {
    const d = nextDeduction(puzzle, topo, fresh.counts, fresh.marks);
    return d && ({ move: d.edgeId, focus: d.island, target: d.edgeId, reason: d.reason,
      kind: d.value === 0 ? 'rule-out' : 'place' } as HintStep<number>);
  },
  chain: (max) =>
    deductionChain(puzzle, topo, fresh.counts, fresh.marks, max).map((d) => ({
      move: d.edgeId, focus: d.island, target: d.edgeId, reason: d.reason,
      kind: d.value === 0 ? 'rule-out' : 'place',
    })),
  describeFocus: (f) => `the ${puzzle.islands[f as number]!.n}`,
};

const ladder = new HintLadder<number>(source, 6);
const r1 = ladder.press();
ok('press 1 gives no answer', r1.apply === undefined && ladder.view.tier === 1);
ok('press 1 points somewhere', ladder.view.focus !== null && /Look at the/.test(ladder.view.message ?? ''));
ok('press 1 does NOT highlight the move', ladder.view.target === null);
const r2 = ladder.press();
ok('press 2 explains, still no answer', r2.apply === undefined && ladder.view.target !== null);
const r3 = ladder.press();
ok('press 3 draws the chain, still no answer', r3.apply === undefined && ladder.view.chain.length > 0);
const r4 = ladder.press();
ok('press 4 finally hands it over', r4.apply !== undefined);
ok('and the ladder resets to the bottom', ladder.view.tier === 0);

/* ---- budget ------------------------------------------------------------ */
ok('course levels are free', hintBudget('level', 2, 1) === Infinity);
ok('later levels are budgeted', hintBudget('level', 40, 1) === 6);
ok('the weekend daily is stingiest', hintBudget('daily', null, 3) === 4);
ok('easier dailies are more generous', hintBudget('daily', null, 1) > hintBudget('daily', null, 3));

const tight = new HintLadder<number>(source, 2);
tight.press();
tight.press();
ok('a spent budget stops giving hints', tight.view.exhausted && tight.press().apply === undefined);

console.log(fails === 0 ? '\nall good' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
