// Online play through the Verve server (Cloudflare, one Durable Object per room, see server/).
// The online code talks to the room as two documents with get / set / update / onSnapshot:
//   rooms/R                 the table, pushed by the server (read-only here)
//   rooms/R/seats/<uid>     my seat doc: my writes go to the server, which runs the game
// Owner commands (approve a buy-in, remove a player, reset) go through serverCmd().
import {SERVER_URL} from './config.js';
import {BB,SB} from './settings.js';
import {M} from './state.js';
import {store} from './util.js';

// where the server is: ?server=… (remembered); else the page's own origin when the Worker served it
// (so a renamed workers.dev address keeps working); else the configured SERVER_URL; '' = no online play
export function serverUrl(){
  try{const q=new URLSearchParams(location.search).get('server');if(q!==null)store.set('poker.server',q);}catch(e){}
  let self='';try{const h=location.hostname;if(h==='localhost'||h==='127.0.0.1'||h==='::1'||h==='[::1]'||/\.workers\.dev$/.test(h))self=location.origin;}catch(e){}
  return (store.get('poker.server')||self||SERVER_URL||'').replace(/\/+$/,'');
}
const rand=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),b=>'abcdefghijklmnopqrstuvwxyz0123456789'[b%36]).join('');
// this browser's identity on the server: a random id plus a secret only it knows
export function localIdentity(){
  let uid=store.get('poker.uid'),token=store.get('poker.token');
  if(!uid||!token){uid='u'+rand(15);token=rand(32);store.set('poker.uid',uid);store.set('poker.token',token);}
  return {uid,token};
}

// the room password never leaves the browser: the server only sees this hash
export async function hashPw(room,pw){
  const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`verve:${room}:${pw}`));
  return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
}
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const snap=v=>({exists:v!=null,data:()=>clone(v)});
export function serverDb(base,id){
  let sock=null,room=null,table,mySeat,gotTable=false,gotSeat=false,outbox=[],retry=null,refused=false;
  const tableSubs=new Set(),seatSubs=new Set(),waiters=[];
  // waiters stay queued until their own condition holds (the seat doc arrives before the table)
  const wake=()=>{for(const w of waiters.slice())if(w.ok()){waiters.splice(waiters.indexOf(w),1);w.r();}};
  const wait=ok=>ok()?Promise.resolve():new Promise(r=>{const w={ok,r};waiters.push(w);setTimeout(()=>{const i=waiters.indexOf(w);if(i>=0)waiters.splice(i,1);r();},6000);});
  function connect(R){
    if(room===R&&sock)return;
    close();room=R;table=null;mySeat=null;gotTable=gotSeat=false;refused=false;
    const solo=R==='solo';
    const u=new URL(base.replace(/^http/,'ws')+(solo?'/solo':'/room/'+R));
    u.searchParams.set('uid',id.uid);u.searchParams.set('token',id.token);
    if(solo){u.searchParams.set('create','1');u.searchParams.set('bots','1');u.searchParams.set('sb',SB);u.searchParams.set('bb',BB);}
    else if(M.creating){u.searchParams.set('create','1');u.searchParams.set('sb',SB);u.searchParams.set('bb',BB);}
    if(M.roomPw)u.searchParams.set('pw',M.roomPw);
    const s=sock=new WebSocket(u);
    s.onopen=()=>{for(const m of outbox.splice(0))s.send(m);};
    s.onmessage=e=>{
      let m;try{m=JSON.parse(e.data);}catch(err){return;}
      if(m.t==='table'){table=m.S;gotTable=true;for(const f of tableSubs)f(snap(table));}
      else if(m.t==='seat'){mySeat=m.doc;gotSeat=true;for(const f of seatSubs)f(snap(mySeat));}
      else if(m.t==='money'){SERVER.onMoney(m);return;}
      else if(m.t==='closed'){SERVER.onClosed();return;}
      else if(m.t==='error'){ // turned away (password, taken code, no such room): stop here, don't retry
        const R2=room;refused=true;outbox=[];tableSubs.clear();seatSubs.clear();close();
        for(const w of waiters.splice(0))w.r();
        SERVER.onError(m.code,R2);return;
      }
      wake();
    };
    s.onclose=()=>{
      if(sock!==s)return;sock=null;
      // dropped (phone slept, network blip): come back and the server resends everything
      if(room&&(tableSubs.size||seatSubs.size)){const R2=room;room=null;clearTimeout(retry);retry=setTimeout(()=>connect(R2),1200);}
    };
  }
  function close(){clearTimeout(retry);if(sock){const s=sock;sock=null;try{s.close();}catch(e){}}room=null;}
  function send(obj){if(refused)return;const m=JSON.stringify(obj);if(sock&&sock.readyState===1)sock.send(m);else outbox.push(m);}
  const done=()=>{if(!tableSubs.size&&!seatSubs.size)close();};
  function doc(path){
    const p=path.split('/');
    const R=p[1];
    if(p.length===2)return {
      get:async()=>{connect(R);await wait(()=>gotTable);return snap(table);},
      onSnapshot:f=>{connect(R);tableSubs.add(f);if(gotTable)f(snap(table));return ()=>{tableSubs.delete(f);done();};},
    };
    return {
      get:async()=>{connect(R);await wait(()=>gotSeat);return snap(mySeat);},
      set:async v=>{mySeat=clone(v);send({t:'seat',op:'set',data:v});for(const f of seatSubs)f(snap(mySeat));},
      update:async v=>{mySeat=Object.assign(mySeat||{},clone(v));send({t:'seat',op:'update',data:v});for(const f of seatSubs)f(snap(mySeat));},
      onSnapshot:f=>{connect(R);seatSubs.add(f);if(gotSeat)f(snap(mySeat));return ()=>{seatSubs.delete(f);done();};},
    };
  }
  SERVER.send=send;
  return {doc,collection:()=>({onSnapshot:()=>()=>{}})};
}
const SERVER={send:()=>{},onError:()=>{},onMoney:()=>{},onClosed:()=>{}};
export function onServerError(f){SERVER.onError=f;}
export function onServerMoney(f){SERVER.onMoney=f;}
// the table closed for the day (23:55 Eastern): everyone goes back to the lobby
export function onServerClosed(f){SERVER.onClosed=f;}
// a buy-in (positive) or cash-out (negative); the server checks it against the database and answers with the balance
export function serverMoney(delta){SERVER.send({t:'money',delta});}
// stand up for good: fold if still playing, take the whole stack home; the server answers with left:true
export function serverLeave(){SERVER.send({t:'leave'});}
// owner commands, run by the server after it checks the sender owns the room
export function serverCmd(name,...args){SERVER.send({t:'cmd',name,args});}
