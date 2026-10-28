// The homepage player row. The server checks poker.uid against a hash of poker.token.
import {setBotNames} from './config.js';
import {serverUrl} from './net.js';

export function playerBase(){
  try{
    const h=location.hostname;
    if(h==='localhost'||h==='127.0.0.1'||h==='::1'||h==='[::1]'||/\.workers\.dev$/.test(h))return location.origin;
  }catch(e){}
  return serverUrl();
}
// Drop a leading robot mark so a person cannot wear a bot's name. Spaces before it do not count.
export function displayName(raw){return String(raw??'').trim().replace(/^#/,'');}
export function cleanPlayerName(raw){
  let name=String(raw??'').replace(/\s+/g,' ').trim();
  name=name.replace(/^(?:\u{1F916}\uFE0F?)+/u,'').trim().slice(0,16);
  return name;
}
export function restrictNameInput(raw){
  const lead=(/^\s*/.exec(raw)||[''])[0];
  return lead+String(raw).slice(lead.length).replace(/^(?:#|\u{1F916}\uFE0F?)+/u,'');
}
async function post(path,body){
  const res=await fetch(`${playerBase()}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json().catch(()=>null);
  return {res,data};
}
// Bot names as the database holds them; without a server the seed names in config stay.
export async function fetchBotNames(){
  const res=await fetch(`${playerBase()}/bots`);
  const data=res.ok?await res.json().catch(()=>null):null;
  if(data&&data.ok&&Array.isArray(data.bots))setBotNames(data.bots);
}
// player: null without a row. old: the row is the closing day's. closing: 23:55 until the new day opens.
// 查看数据: the player's stats row for today (null before their first hand)
export async function fetchStats(uid,token){
  const {res,data}=await post('/player/stats',{uid,token});
  if(!res.ok||!data||!data.ok)throw new Error('stats');
  return data.stats;
}
// a player's card at the table: anyone's stats for today (bots included)
export async function fetchSeatStats(id){
  const res=await fetch(`${playerBase()}/stats?id=${encodeURIComponent(id)}`,{cache:'no-store'});
  const data=res.ok?await res.json().catch(()=>null):null;
  if(!data||!data.ok)throw new Error('stats');
  return data.stats;
}
// The lobby's board: today live, then yesterday, week, month and all time as saved. Each is {name, money} or null.
export async function fetchBoard(){
  const res=await fetch(`${playerBase()}/leaderboard`,{cache:'no-store'});
  const data=res.ok?await res.json().catch(()=>null):null;
  return data&&data.ok&&data.board?data.board:null;
}
export async function fetchPlayer(uid,token){
  const {res,data}=await post('/player/get',{uid,token});
  const p=res.ok&&data&&data.player,closing=!!(data&&data.closing);
  if(!p||typeof p.name!=='string'||!Number.isInteger(p.balance))return {player:null,closing};
  return {player:{name:p.name,balance:p.balance,old:!!p.old},closing};
}
// The day is over for this browser's player once the new day opens: forget the id and start as a new visitor.
export function forgetIdentity(){
  try{for(const k of ['poker.uid','poker.token','poker.nick'])localStorage.removeItem(k);}catch(e){}
}
export const dayIsOver=(player,closing)=>!!(player&&player.old&&!closing);
export async function savePlayer(uid,token,name){
  const {res,data}=await post('/player/set',{uid,token,name});
  const p=res.ok&&data&&data.ok&&data.player;
  if(!p||typeof p.name!=='string'||!Number.isInteger(p.balance))return {error:(data&&data.error)||'save'};
  return {created:!!data.created,player:{name:p.name,balance:p.balance}};
}
