// Verve Poker server entry: /room/<CODE> upgrades to a WebSocket handled by that room's Durable Object,
// /rooms lists the rooms people are in. Everything else is the site, served from static assets.
export { Room } from './room.js';
export { Lobby } from './lobby.js';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Z0-9]{3,8})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
      return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
    }
    if (url.pathname === '/rooms' && req.method === 'GET') {
      const res = await env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch('https://lobby/list');
      // the GitHub Pages copy of the site reads this too, from another origin
      return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
    }
    if (url.pathname === '/health') return new Response('ok');
    return new Response('Verve Poker server', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};
