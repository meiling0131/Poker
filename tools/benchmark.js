// Runs tools/simulate.js against several sparring strategies and seeds in parallel and
// prints each bot's average result per 100 hands (higher = stronger).
//   node tools/benchmark.js [hands=300] [seeds=3] [heroes=fold,station,maniac,nit,tag,bot]
import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
const hands = Number(process.argv[2] || 300), seeds = Number(process.argv[3] || 3);
const heroes = (process.argv[4] || 'fold,station,maniac,nit,tag,bot').split(',');
const jobs = heroes.flatMap(h => Array.from({ length: seeds }, (_, i) => [h, i + 1]));
const run = ([h, sd]) => new Promise((ok, bad) => execFile('node', [new URL('./simulate.js', import.meta.url).pathname, hands, h, sd, '--json'],
  { maxBuffer: 1e7 }, (e, out) => e ? bad(e) : ok({ h, ...JSON.parse(out.trim().split('\n').pop()) })));
const results = []; let next = 0;
await Promise.all(Array.from({ length: Math.max(1, cpus().length) }, async () => { while (next < jobs.length) results.push(await run(jobs[next++])); }));
const table = {};
for (const r of results) for (const row of r.rows) {
  const who = row.who.startsWith('你') ? '你' : row.who;
  ((table[who] ||= {})[r.h] ||= []).push(row.net * 100 / r.hands);
}
const avg = a => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
const out = Object.entries(table).map(([who, byHero]) => ({ who, ...Object.fromEntries(heroes.map(h => [h, avg(byHero[h])])), all: avg(heroes.map(h => avg(byHero[h]))) }));
console.log(`net chips per 100 hands · ${hands} hands × ${seeds} seeds per sparring partner`);
console.table(out);
