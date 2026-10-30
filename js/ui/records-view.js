// 记录 page: stats, ledger, logs, players.
import {CONFIRM_KICK,roomLink} from '../online.js';
import {BUY,isBotId} from '../config.js';
import {M,S} from '../state.js';
import {ZS,pct} from '../stats.js';
import {bookKey,isKicked,isOwner,nameOfKey,nameOfUid,names,netOf} from '../table.js';
import {seatName} from './table-view.js';
import {$,esc,fmt,sgn} from '../util.js';
import {tr,tx} from '../i18n.js';

export function statsHTML(){
  const st=S.stats||{},meKey=M.me,me=Object.assign(ZS(),st[meKey]);
  const nb=S.seats.some(p=>bookKey(p)===meKey)||S.book[meKey]?netOf(meKey).net:0;
  const tile=(v,l,hint)=>`<div class="stat"><b>${v}</b><span>${l}</span>${hint?`<i>${hint}</i>`:''}</div>`;
  const mine=`<section class="panel"><h2>${tr('我的统计')} <span>${S.mode==='bots'?(M.solo?tr('人机模式累计 · 存在这张牌桌'):tr('人机模式累计 · 存在本机')):tr('本房间')}</span></h2>
    ${me.h?`<div class="stats">
      ${tile(fmt(me.h),tr('打了几手'))}
      ${tile(pct(me.vp,me.h),tr('入池率'),tr('主动跟注或加注'))}
      ${tile(pct(me.pr,me.h),tr('翻前加注'))}
      ${tile(fmt(me.w),tr('赢了几手'),pct(me.w,me.h))}
      ${tile(me.sd?pct(me.sdw,me.sd):'—',tr('摊牌胜率'),me.sd?`${me.sdw}/${me.sd}`:'')}
      ${tile(fmt(me.big),tr('最大底池'))}
    </div>${S.mode==='online'?`<p>${tr('本房间盈亏')} <span class="${nb>0?'pos':nb<0?'neg':''}">${sgn(nb)}</span></p>`:''}${S.mode==='bots'?`<button class="mini" data-stats-reset="1">${tr('清空我的统计')}</button>`:''}`
    :`<p>${tr('打完一手就有数据了。')}</p>`}</section>`;
  const keys=Object.keys(st).filter(k=>st[k].h>0&&(S.mode==='online'||k!=='local'));
  const all=keys.length?`<section class="panel"><h2>${tr('全桌统计')} <span>${S.mode==='bots'?tr('这一桌'):tr('本房间')}</span></h2>
    <div class="scroll"><table class="book"><thead><tr><th>${tr('玩家')}</th><th>${tr('手数')}</th><th>${tr('入池')}</th><th>${tr('加注')}</th><th>${tr('赢')}</th><th>${tr('最大底池')}</th></tr></thead><tbody>
    ${keys.sort((a,b)=>st[b].h-st[a].h).map(k=>{const x=st[k];return `<tr class="${k===meKey?'mine':''}"><td>${esc(nameOfKey(k))}</td><td>${x.h}</td><td>${pct(x.vp,x.h)}</td><td>${pct(x.pr,x.h)}</td><td>${x.w}</td><td>${fmt(x.big)}</td></tr>`;}).join('')}
    </tbody></table></div></section>`:'';
  return mine+all;
}
export const kickBtn=u=>`<button class="kick${CONFIRM_KICK===u?' warn':''}" data-kick="${esc(u)}">${CONFIRM_KICK===u?tr('确认请出？'):tr('请出')}</button>`;
export function renderRecords(){
  const el=$('records');
  const tm=t=>{const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');};
  const seatedKeys=S.seats.map(bookKey);
  const keys=[...new Set(seatedKeys.concat(Object.keys(S.book)))];
  keys.sort((a,b)=>(isBotId(a)?1:0)-(isBotId(b)?1:0)||(seatedKeys.indexOf(a)<0?1:0)-(seatedKeys.indexOf(b)<0?1:0));
  let tin=0,tout=0,ton=0;
  const rows=keys.map(k=>{const n=netOf(k);tin+=n.in;tout+=n.out;ton+=n.onTable;
    return `<tr class="${k===M.me?'mine':''}"><td>${esc(nameOfKey(k))}${n.seated?'':` <span class="off">${tr('已离桌')}</span>`}</td><td>${fmt(n.in)}</td><td>${fmt(n.out)}</td><td>${fmt(n.onTable)}</td><td class="${n.net>0?'pos':n.net<0?'neg':''}">${sgn(n.net)}</td></tr>`;}).join('');
  const invite=S.mode==='online'?`<section class="panel"><h2>${tr('邀请朋友')} <span>${tr('房间 {code}',{code:esc(M.room)})}</span></h2>
      <div class="invite"><code id="linktxt">${esc(roomLink())}</code><button class="mini" data-copy="1">${tr('复制链接')}</button></div>
      <p>${tr('朋友打开链接、留个名字就能进来，不需要注册账号。')}</p></section>`:'';
  const people=S.mode==='online'?`<section class="panel"><h2>${tr('玩家§section')} <span>${[tr('{n} 在座',{n:S.seats.length}),(S.pending||[]).length?tr('{n} 排队',{n:S.pending.length}):'',tr('上限 10')].filter(Boolean).join(' · ')}</span></h2>
      <div class="people">${S.seats.map(p=>`<span class="person">${esc(seatName(p))}${p.stack===0?' · '+tr('未买入'):''}${p.leaving?' · '+tr('离座中'):''}${isOwner()&&p.uid!==M.me&&!isKicked(p.uid)?kickBtn(p.uid):''}</span>`).join('')}${(S.pending||[]).map(u=>`<span class="person wait">${esc(nameOfUid(u))} · ${tr('排队')}${isOwner()?kickBtn(u):''}</span>`).join('')||''}</div>
      ${isOwner()&&S.kicked&&Object.keys(S.kicked).length?`<div class="people">${Object.keys(S.kicked).map(u=>`<span class="person wait">${esc(nameOfUid(u))} · ${tr('已请出')}<button class="kick" data-unkick="${esc(u)}">${tr('允许回来')}</button></span>`).join('')}</div>`:''}
      <p>${isOwner()?tr('你是房主。发牌在 Verve 服务器上进行，你离开或锁屏都不影响牌局。'):tr('发牌在 Verve 服务器上进行。你的底牌只发给你，别人（包括房主）都看不到。')}</p></section>`:'';
  el.innerHTML=`${statsHTML()}${invite}${people}
    <section class="panel"><h2>${tr('账本')} <span>${tr('一手 {n}',{n:fmt(BUY)})}</span></h2>
      <div class="scroll"><table class="book"><thead><tr><th>${tr('玩家')}</th><th>${tr('买入')}</th><th>${tr('退出')}</th><th>${tr('桌上')}</th><th>${tr('盈亏')}</th></tr></thead><tbody>${rows||`<tr><td colspan="5">${tr('还没有人买入。')}</td></tr>`}</tbody>
      <tfoot><tr><td>${tr('合计')}</td><td>${fmt(tin)}</td><td>${fmt(tout)}</td><td>${fmt(ton)}</td><td>${sgn(ton+tout-tin)}</td></tr></tfoot></table></div></section>
    <section class="panel"><h2>${tr('买入 / 退出记录')} <span>${tr('{n} 笔',{n:S.ledger.length})}</span></h2>
      ${S.ledger.length?`<ol class="rec">${S.ledger.map(r=>`<li><time>${tm(r.t)}</time><span class="k">${esc(nameOfKey(r.k))}</span><span class="${r.kind==='buy'?'buy':'cash'}">${r.kind==='buy'?tr('买一手'):r.kind==='cash'?tr('退一手'):tr('离桌带走')} ${fmt(r.amt)}</span></li>`).join('')}</ol>`:`<p>${tr('还没有买入或退出记录。')}</p>`}</section>
    <section class="panel"><h2>${tr('牌局记录')} <span>${tr('最近 {n} 条',{n:S.log.length})}</span></h2>
      <ol class="lg">${S.log.map(l=>`<li class="${l.cls}">${names(tx(l.t))}</li>`).join('')}</ol></section>
    <p class="note">${tr('洗牌用 crypto.getRandomValues 做无偏 Fisher–Yates，每手重洗一副 52 张。练习模式在你的浏览器里洗牌发牌；正常模式和好友房间由 Verve 服务器（Cloudflare）洗牌发牌，每位玩家的底牌经加密连接只发给本人，其他人（包括房主）的浏览器里都没有，摊牌时才亮出来。轮到真人时限 45 秒，超时自动过牌或弃牌。')}</p>`;
}
