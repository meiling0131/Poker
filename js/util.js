// Small helpers shared by every module.

export const $=id=>document.getElementById(id);
export const fmt=n=>Number(n).toLocaleString('en-US');
export const secsLeft=until=>Math.max(0,Math.ceil((+until-Date.now())/1000))+'s';
export const cdSpan=(until,cls='cd')=>`<span class="${cls}" data-until="${until}">${secsLeft(until)}</span>`;
export const sgn=n=>(n>0?'+':n<0?'−':'')+fmt(Math.abs(n));
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const store={get(k){try{return localStorage.getItem(k);}catch(e){return null;}},set(k,v){try{localStorage.setItem(k,v);}catch(e){}}};

const ET='America/New_York';
function etParts(date){
  const fmt=new Intl.DateTimeFormat('en-US',{timeZone:ET,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const o={};
  for(const p of fmt.formatToParts(date)) if(p.type!=='literal') o[p.type]=p.value;
  o.hour=String((+o.hour)%24).padStart(2,'0');
  return o;
}
function etOffset(date){
  const p=etParts(date);
  return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-Math.floor(date.getTime()/1000)*1000;
}
export function easternDay(date=new Date(Date.now())){const p=etParts(date);return `${p.year}-${p.month}-${p.day}`;}
export function msUntilEasternMidnight(now=Date.now()){
  const p=etParts(new Date(now));
  const next=Date.UTC(+p.year,+p.month-1,+p.day+1);
  let at=next-etOffset(new Date(now));
  at=next-etOffset(new Date(at));
  if(at<=now) at=next+86400000-etOffset(new Date(at+3600000));
  return Math.max(0,at-now);
}
// The day's close (DATABASE.md, "The day"): from 23:55 Eastern no new hands, and from 00:00 to 00:05 a hand still
// running from the old day is overtime. 'closing' 23:55–24:00, 'overtime' 00:00–00:05, otherwise 'open'.
export const CLOSE_MIN=23*60+55,OVERTIME_MIN=5;
export function easternMinute(now=Date.now()){const p=etParts(new Date(now));return +p.hour*60+ +p.minute;}
export function dayPhase(now=Date.now()){const m=easternMinute(now);return m>=CLOSE_MIN?'closing':m<OVERTIME_MIN?'overtime':'open';}
// the next 23:55, 00:00 or 00:05 Eastern after now (all three sit next to midnight, away from the 2am clock change)
export function nextDayMark(now=Date.now()){
  const mid=now+msUntilEasternMidnight(now),p=etParts(new Date(now)),sinceMid=(+p.hour*3600+ +p.minute*60+ +p.second)*1000;
  return [now-sinceMid+OVERTIME_MIN*60e3,mid-5*60e3,mid,mid+OVERTIME_MIN*60e3].filter(t=>t>now).sort((a,b)=>a-b)[0];
}
// is_previous_day for something that belongs to `day` (a hand: the day it started), written at `now`
export function prevFlag(day,now=Date.now()){return day<easternDay(new Date(now))||dayPhase(now)==='closing'?1:0;}
// YYYY-MM-DD one day either side, by the calendar
export function shiftDay(day,n){const [y,m,d]=day.split('-').map(Number);const t=new Date(Date.UTC(y,m-1,d+n));return t.toISOString().slice(0,10);}
export function resetInLabel(now=Date.now()){
  const sec=Math.max(0,Math.ceil(msUntilEasternMidnight(now)/1000));
  const pad=n=>String(n).padStart(2,'0');
  return `${pad(Math.floor(sec/3600))}:${pad(Math.floor(sec%3600/60))}:${pad(sec%60)}`;
}
