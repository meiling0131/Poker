// Verve Poker server entry: /room/<CODE> upgrades to a WebSocket handled by that room's Durable Object.
export { Room } from './room.js';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Z0-9]{3,8})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
      return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
    }
    if (url.pathname === '/health') return new Response('ok');
    return new Response('Verve Poker server', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};
