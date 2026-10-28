// A D1 stand-in over node:sqlite with the real migrations applied. batch() is one transaction, like D1.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../migrations/', import.meta.url);

export function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  for (const f of readdirSync(DIR).filter(n => n.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(f, DIR), 'utf8'));
  const exec = (q, args, how) => {
    const st = sql.prepare(q);
    if (how === 'first') return st.get(...args) ?? null;
    if (how === 'all') return { results: st.all(...args) };
    const r = st.run(...args);
    return { meta: { changes: Number(r.changes) } };
  };
  const db = {
    sql,
    prepare(q) {
      const stmt = {
        args: [],
        bind(...args) { return Object.assign(Object.create(stmt), { args }); },
        async first() { return exec(q, this.args, 'first'); },
        async all() { return exec(q, this.args, 'all'); },
        async run() { return exec(q, this.args, 'run'); },
        q,
      };
      return stmt;
    },
    async batch(list) {
      sql.exec('BEGIN');
      try {
        const out = list.map(s => exec(s.q, s.args, /^\s*select/i.test(s.q) ? 'all' : 'run'));
        sql.exec('COMMIT');
        return out;
      } catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
    rows: q => sql.prepare(q).all(),
  };
  return db;
}
