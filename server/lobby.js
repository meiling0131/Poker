// The room list (大厅): one Durable Object that every room reports to. A room is listed while somebody
// is connected to it; it reports itself gone when the last person leaves. Entries nobody has refreshed
// for a while are dropped in case a report was lost.
const STALE = 6 * 3600e3;

export class Lobby {
  constructor(ctx) { this.ctx = ctx; this.rooms = null; }
  async load() {
    if (!this.rooms) this.rooms = (await this.ctx.storage.get('rooms')) || {};
    return this.rooms;
  }
  async fetch(req) {
    const rooms = await this.load(), now = Date.now();
    if (req.method === 'POST') {   // only rooms reach this, through the LOBBY binding
      const r = await req.json().catch(() => null);
      if (!r || typeof r.code !== 'string') return new Response('bad report', { status: 400 });
      if (r.gone) delete rooms[r.code];
      else rooms[r.code] = { code: r.code, n: r.n | 0, online: r.online | 0, pw: !!r.pw, sb: r.sb | 0, bb: r.bb | 0, host: String(r.host || '').slice(0, 16), t: now };
      await this.ctx.storage.put('rooms', rooms);
      return new Response('ok');
    }
    for (const [k, r] of Object.entries(rooms)) if (now - r.t > STALE) delete rooms[k];
    const list = Object.values(rooms).sort((a, b) => b.online - a.online || b.t - a.t).slice(0, 30)
      .map(({ code, n, online, pw, sb, bb, host }) => ({ code, n, online, pw, sb, bb, host }));
    return new Response(JSON.stringify(list), { headers: { 'content-type': 'application/json' } });
  }
}
