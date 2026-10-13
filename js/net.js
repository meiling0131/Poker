// Online play through the Verve server (Cloudflare, one Durable Object per room, see server/).
// It presents the small slice of the Firestore API that the online code uses, so the rest of the
// client stays the same:
//   rooms/R                 the table, pushed by the server (read-only here)
//   rooms/R/seats/<uid>     my seat doc: my writes go to the server, which runs the game
//   users/<uid>/private/*   kept in this browser (the server deals, so no hole-card encryption)
// Owner commands (approve a buy-in, remove a player, reset) go through serverCmd().
import {SERVER_URL} from './config.js';
import {BB,SB} from './settings.js';
import {M} from './state.js';
import {store} from './util.js';

// where the server is: ?server=… (remembered), else the configured SERVER_URL; '' = use Firebase
export function serverUrl(){
  try{const q=new URLSearchParams(location.search).get('server');if(q!==null)store.set('poker.server',q);}catch(e){}
  return (store.get('poker.server')||SERVER_URL||'').replace(/\/+$/,'');
}
const rand=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),b=>'abcdefghijklmnopqrstuvwxyz0123456789'[b%36]).join('');
// this browser's identity on the server: a random id plus a secret only it knows
export function localIdentity(){
  let uid=store.get('poker.uid'),token=store.get('poker.token');
  if(!uid||!token){uid='u'+rand(15);token=rand(32);store.set('poker.uid',uid);store.set('poker.token',token);}
  return {uid,token};
}

const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const snap=v=>({exists:v!=null,data:()=>clone(v)});
export function serverDb(base,id){
  let sock=null,room=null,table,mySeat,gotTable=false,gotSeat=false,outbox=[],retry=null;
  const tableSubs=new Set(),seatSubs=new Set(),waiters=[];
  // waiters stay queued until their own condition holds (the seat doc arrives before the table)
  const wake=()=>{for(const w of waiters.slice())if(w.ok()){waiters.splice(waiters.indexOf(w),1);w.r();}};
  const wait=ok=>ok()?Promise.resolve():new Promise(r=>{const w={ok,r};waiters.push(w);setTimeout(()=>{const i=waiters.indexOf(w);if(i>=0)waiters.splice(i,1);r();},6000);});
  function connect(R){
    if(room===R&&sock)return;
    close();room=R;table=null;mySeat=null;gotTable=gotSeat=false;
    const u=new URL(base.replace(/^http/,'ws')+'/room/'+R);
    u.searchParams.set('uid',id.uid);u.searchParams.set('token',id.token);
    if(M.creating){u.searchParams.set('create','1');u.searchParams.set('sb',SB);u.searchParams.set('bb',BB);}
    const s=sock=new WebSocket(u);
    s.onopen=()=>{for(const m of outbox.splice(0))s.send(m);};
    s.onmessage=e=>{
      let m;try{m=JSON.parse(e.data);}catch(err){return;}
      if(m.t==='table'){table=m.S;gotTable=true;for(const f of tableSubs)f(snap(table));}
      else if(m.t==='seat'){mySeat=m.doc;gotSeat=true;for(const f of seatSubs)f(snap(mySeat));}
      wake();
    };
    s.onclose=()=>{
      if(sock!==s)return;sock=null;
      // dropped (phone slept, network blip): come back and the server resends everything
      if(room&&(tableSubs.size||seatSubs.size)){const R2=room;room=null;clearTimeout(retry);retry=setTimeout(()=>connect(R2),1200);}
    };
  }
  function close(){clearTimeout(retry);if(sock){const s=sock;sock=null;try{s.close();}catch(e){}}room=null;}
  function send(obj){const m=JSON.stringify(obj);if(sock&&sock.readyState===1)sock.send(m);else outbox.push(m);}
  const done=()=>{if(!tableSubs.size&&!seatSubs.size)close();};
  function doc(path){
    const p=path.split('/');
    if(p[0]==='users')return {get:async()=>snap(JSON.parse(store.get('poker.k.'+path)||'null')),set:async v=>store.set('poker.k.'+path,JSON.stringify(v))};
    const R=p[1];
    if(p.length===2)return {
      get:async()=>{connect(R);await wait(()=>gotTable);return snap(table);},
      onSnapshot:f=>{connect(R);tableSubs.add(f);if(gotTable)f(snap(table));return ()=>{tableSubs.delete(f);done();};},
    };
    if(p[2]==='meta')return {get:async()=>snap(null),set:async()=>{},onSnapshot:()=>()=>{}}; // records come inside the table
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
const SERVER={send:()=>{}};
// owner commands, run by the server after it checks the sender owns the room
export function serverCmd(name,...args){SERVER.send({t:'cmd',name,args});}
