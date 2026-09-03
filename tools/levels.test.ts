import { buildLevelSet, buildProgress, nextLevel, dailyUnlocked, isUnlocked, chapterProgress, allLevels } from '../packages/core/src/levels';
import { computeStats, computeStreak } from '../packages/player/src/stats';
import type { PlayResult } from '../packages/core/src/types';

let fails = 0;
const ok = (name: string, cond: boolean) => { console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}`); if (!cond) fails++; };

const set = buildLevelSet('arrows', [
  { id: '1', title: 'Send them out', teaches: 'Tap an arrow and it flies.', levels: [{difficulty:1},{difficulty:1},{difficulty:1},{difficulty:1},{difficulty:1},{difficulty:1}] },
  { id: '2', title: 'In the way', teaches: 'A blocked arrow stops instead.', levels: [{difficulty:2},{difficulty:2},{difficulty:2},{difficulty:2},{difficulty:2},{difficulty:2}] },
]);

ok('12 levels, ids assigned', allLevels(set).length === 12 && allLevels(set)[0]!.id === '1-01');
ok('indices are global', allLevels(set)[6]!.index === 6 && allLevels(set)[6]!.chapter === '2');

const lvl = (id: string, solved = true): PlayResult => ({ game:'arrows', puzzle:id, mode:'level', solved, ms:9000, moves:12, hints:0, difficulty:1, finishedAt: Date.now() });
const day = (d: string): PlayResult => ({ game:'arrows', puzzle:d, mode:'daily', solved:true, ms:60000, moves:30, hints:0, difficulty:2, finishedAt: Date.now() });

let p = buildProgress(set, [lvl('1-01'), lvl('1-02'), lvl('1-03')]);
ok('progress counts solves', p.levelsSolved === 3 && p.furthestIndex === 2);
ok('next level is 1-04', nextLevel(set, p)?.id === '1-04');
ok('daily still locked at 3', dailyUnlocked(p) === false);
ok('lookahead unlocks 1-05', isUnlocked(allLevels(set)[4]!, p) === true);
ok('but not 1-06', isUnlocked(allLevels(set)[5]!, p) === false);
ok('chapter 1: 3 of 6', chapterProgress(set.chapters[0]!, p).solved === 3);

p = buildProgress(set, allLevels(set).slice(0,10).map(l => lvl(l.id)));
ok('daily unlocks at 10', dailyUnlocked(p) === true);

// levels must not create a streak; dailies must
const mixed = [lvl('1-01'), lvl('1-02'), day('2026-09-01'), day('2026-09-02'), day('2026-09-03')];
const streak = computeStreak(mixed, '2026-09-03');
ok('streak counts dailies only', streak.current === 3 && streak.best === 3);
const st = computeStats(mixed, '2026-09-03');
ok('stats split modes', st.levelsSolved === 2 && st.dailiesSolved === 3 && st.solved === 5);
ok('weekday chart ignores levels', st.byWeekday.reduce((a,b)=>a+b,0) === 3);
ok('unsolved level not counted', buildProgress(set, [lvl('1-01', false)]).levelsSolved === 0);

console.log(fails === 0 ? '\nall good' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
