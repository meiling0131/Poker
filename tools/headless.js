// Lets the game engine run in Node: stub browser globals, virtual timers, seeded randomness.
// Import this before any game module (game modules must then be loaded with dynamic import()).
const noop = () => {};
globalThis.window = globalThis;
globalThis.document = { addEventListener: noop, getElementById: () => null, querySelectorAll: () => [], body: { dataset: {} }, visibilityState: 'hidden' };
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
let now = 0, seq = 0; const timers = new Map();
globalThis.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { fn, at: now + Math.max(0, ms) }); return id; };
globalThis.clearTimeout = id => { timers.delete(id); };
globalThis.setInterval = () => 0;
export function runNextTimer() {
  let best = null;
  for (const [id, t] of timers) if (!best || t.at < best[1].at || (t.at === best[1].at && id < best[0])) best = [id, t];
  if (!best) return false;
  timers.delete(best[0]); now = Math.max(now, best[1].at); best[1].fn(); return true;
}
// seeded Math.random so runs are repeatable
let seed = Number(process.env.SEED || process.argv[4] || 1) >>> 0 || 1;
Math.random = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const realGRV = crypto.getRandomValues.bind(crypto);
crypto.getRandomValues = a => { if (a instanceof Uint32Array) { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 2 ** 32); return a; } return realGRV(a); };
