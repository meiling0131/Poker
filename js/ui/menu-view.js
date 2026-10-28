// Header and lobby.
import {PLAY_MODE,PRESET,PRESETS,SB,BB} from '../settings.js';
import {FLASH,LOBBY,M,S,VIEW} from '../state.js';
import {displayName} from '../player.js';
import {fetchRooms} from '../net.js';
import {eval5,handName} from '../cards.js';
import {cardHTML} from './table-view.js';
import {$,dayPhase,esc,fmt,msUntilEasternMidnight,resetInLabel} from '../util.js';

let NAME_POPUP=false,NAME_ASK='',NAME_NEXT='';
// the board from /leaderboard; setBoard says whether it changed (the banner is only redrawn then)
let BOARD=null;
export function setBoard(b){const same=JSON.stringify(b)===JSON.stringify(BOARD);BOARD=b;return !same;}
const SLOTS=[['today','今日最佳'],['yesterday','昨日最佳'],['week','本周最佳'],['month','本月最佳'],['all_time','历史最佳']];
export function setNamePopup(v){NAME_POPUP=!!v;if(!v){NAME_ASK='';NAME_NEXT='';LOBBY.open=null;LOBBY.confirm=null;}}
export function setNameAsk(v){NAME_ASK=v;}
export function setNameNext(v){NAME_NEXT=v;}
export function nameNext(){return NAME_NEXT;}
const storedName=()=>(M.player&&M.player.name||'').trim();
const sessionName=()=>displayName(storedName());
const nameChanged=()=>storedName().startsWith('#');
export function shownBalance(){return M.player&&Number.isInteger(M.player.balance)?M.player.balance:BALANCE;}

export function renderHeader(){
  const online=M.mode==='online';
  $('pills').innerHTML=!M.mode?'':`<span class="pill">${online?`房间 ${esc(M.room||'')}`:`${PLAY_MODE==='normal'?'正常':'练习'} · 7 人`}</span><span class="pill">盲注 ${SB}/${BB}</span>${S&&S.hand?`<span class="pill">第 ${S.hand} 手</span>`:''}`;
  $('nav').hidden=!M.mode;
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.view===VIEW));
  // 记录 is open in a friends room: the invite link, the players (the owner can remove them) and the ledger
  const rec=document.querySelector('#nav [data-view="records"]');
  if(rec){rec.disabled=!online;rec.title=online?'':'暂未开放';}
  $('exitBtn').hidden=!M.mode;
  if(!M.mode)$('exitPopup').hidden=true;
}
export const BALANCE=1000;
// Cash a table can buy with: the database balance on the worker, a pretend 1,000 in practice.
export function tableCash(){return M.host?BALANCE:shownBalance();}
const chip=cls=>`<i class="chip-d ${cls}" aria-hidden="true"></i>`;
const stakeIcon=sb=>sb===2?`<span class="chip-stack">${chip('w')}${chip('w')}</span>`:chip(sb===5?'r':'w');
// 查看数据: the player's stats row for today. STATS: undefined until loaded, null before the first hand, 'error'.
let STATS;
export function setStats(v){STATS=v;}
// counts first, then the ratios. pct: the stats column holding the ratio; WTSD has none, so it is worked out here
const COUNT_CARDS=[
  {k:'hands',zh:'手数',about:'今天发到你手里的总手数。'},
  {k:'hands_won',zh:'赢的手数',about:'今天赢得至少一个底池的手数，平分也算。'},
];
const STAT_CARDS=[
  {k:'vpip',en:'VPIP',zh:'入池率',num:'vpip',den:'hands',denLbl:'手',pct:'vpip_pct',about:'翻牌前主动把筹码放进底池（跟注或加注，盲注不算）的手数，占所有手数的比例。越高说明玩得越松。'},
  {k:'pfr',en:'PFR',zh:'翻前加注率',num:'pfr',den:'hands',denLbl:'手',pct:'pfr_pct',about:'翻牌前加注的手数，占所有手数的比例。和入池率越接近，打法越凶。'},
  {k:'ats',en:'ATS',zh:'偷盲率',num:'ats',den:'ats_opp',denLbl:'次机会',pct:'ats_pct',about:'坐在关煞位、庄位或小盲位，而且前面所有人都弃牌时，选择加注的比例。'},
  {k:'3bet',en:'3BET',zh:'再加注率',num:'3bet',den:'hands',denLbl:'手',pct:'3bet_pct',about:'翻牌前面对一次开局加注时再加注的次数，占所有手数的比例。'},
  {k:'wtsd',en:'WTSD',zh:'摊牌率',num:'wtsd',den:'saw_flop',denLbl:'次看翻牌',about:'看到翻牌之后，一直坚持到摊牌的比例。'},
  {k:'wsd',en:'WSD',zh:'摊牌胜率',num:'wsd',den:'wtsd',denLbl:'次摊牌',pct:'wsd_pct',about:'进入摊牌后赢得底池的比例。平分也算赢。'},
  {k:'wwsf',en:'WWSF',zh:'翻后胜率',num:'wwsf',den:'saw_flop',denLbl:'次看翻牌',pct:'wwsf_pct',about:'看到翻牌后最终赢得底池的比例，包括对手弃牌让你赢。'},
];
// A ratio from the stats column holding it; where there is none (WTSD, or a practice table's own counts) from the counts.
const ratioOf=(c,d)=>{
  if(!d)return null;
  if(c.pct&&d[c.pct]!==undefined)return d[c.pct];
  const n=d[c.den]||0;return n?(d[c.num]||0)/n:null;
};
const pctOf=(c,d)=>{const v=ratioOf(c,d);return v==null?'—':Math.round(v*100)+'%';};
// 'Ah,Kd,Ts,7c,2d' → the five cards and their hand type; a fold win (NA) has nothing shown
const CODE_R='23456789TJQKA',CODE_S='shdc';
function bestHandHTML(d){
  const amt=d?d.biggest_win_amount||0:0,codes=String(d&&d.biggest_win_hand||'').split(',').filter(Boolean);
  if(!amt)return `<div class="stat-best"><small>最大赢池</small><p class="name-note">今天还没有赢过底池。</p></div>`;
  const cards=codes.map(x=>CODE_R.indexOf(x[0])>=0&&CODE_S.indexOf(x[1])>=0?CODE_S.indexOf(x[1])*13+CODE_R.indexOf(x[0]):null);
  const shown=cards.length===5&&cards.every(c=>c!=null);
  return `<div class="stat-best"><small>最大赢池</small><b>${fmt(amt)}</b>
          <div class="stat-hand">${(shown?cards:[null,null,null,null,null]).map(c=>cardHTML(c,'bigwin')).join('')}</div>
          <span>${shown?handName(eval5(...cards)):'对手弃牌，未亮牌'}</span></div>`;
}
// The stats popup, shared by the lobby's 查看数据 and a player's card at the table.
// data: the stats (undefined while loading, null before the first hand, 'error'); card(k): the attributes a card
// opens its explanation with; foot: the buttons at the bottom; note: the line above the cards' counts.
export function statsView({tag,data,card,foot,today=true}){
  const body=data===undefined?'<p class="name-note">正在读取…</p>'
    :data==='error'?'<p class="name-note">没能读取数据，请稍后再试。</p>'
    :`<div class="stat-grid">${COUNT_CARDS.map(c=>`<button type="button" class="stat-card" ${card(c.k)}><b>${fmt(data?data[c.k]||0:0)}</b><small>${c.zh}</small></button>`).join('')}</div>
        ${bestHandHTML(data)}
        <div class="stat-grid">${STAT_CARDS.map(c=>`<button type="button" class="stat-card" ${card(c.k)}><b>${pctOf(c,data)}</b><span>${c.en}</span><small>${c.zh}</small></button>`).join('')}</div>
        ${data?'':`<p class="name-note">打完第一手后开始统计。</p>`}${today?'':'<p class="name-note">练习模式：本次练习的数据，不计入排行。</p>'}`;
  return `
        <div id="usernamePopupTitle" class="popup-tag">${tag}</div>${body}
        <div class="usernamePopup-actions">${foot}</div>`;
}
export function statView({k,data,foot,today=true}){
  const day=today?'今日':'本次练习';
  const count=COUNT_CARDS.find(x=>x.k===k);
  if(count){
    const extra=k==='hands_won'&&data&&data.hands?`<p class="name-note">占${day}手数的 ${Math.round((data.hands_won||0)*100/data.hands)}%</p>`:'';
    return `
        <b id="usernamePopupTitle">${count.zh}</b>
        <p class="stat-big">${fmt(data?data[k]||0:0)}</p>
        <p class="name-note">${count.about}</p>${extra}
        <div class="usernamePopup-actions">${foot}</div>`;
  }
  const c=STAT_CARDS.find(x=>x.k===k)||STAT_CARDS[0],n=data?data[c.num]||0:0,dn=data?data[c.den]||0:0;
  return `
        <b id="usernamePopupTitle">${c.en} · ${c.zh}</b>
        <p class="stat-big">${pctOf(c,data)}</p>
        <p class="name-note">${c.about}</p>
        <p class="name-note">${day}：${fmt(n)} / ${fmt(dn)} ${c.denLbl}</p>
        <div class="usernamePopup-actions">${foot}</div>`;
}
// 设置: changes are a draft until 确认. sound: every sound effect (游戏音效); speed: how long a bot thinks (ms).
export const SPEEDS=[[1100,'较慢'],[650,'中等'],[250,'较快']];
let DRAFT={sound:true,speed:650};
export function setSettingsDraft(d){DRAFT=Object.assign({},DRAFT,d);}
export function settingsDraft(){return DRAFT;}
function settingsHTML(named,back){
  return `
        <b id="usernamePopupTitle">设置</b>
        <div class="set-row"><span>游戏音效</span><div class="seg">${[[false,'关闭'],[true,'启用']].map(([v,l])=>`<button type="button" data-set-sound="${v?1:0}"${DRAFT.sound===v?' class="on"':''}>${l}</button>`).join('')}</div></div>
        <div class="set-row"><span>机器人速度</span><div class="seg">${SPEEDS.map(([v,l])=>`<button type="button" data-set-speed="${v}"${DRAFT.speed===v?' class="on"':''}>${l}</button>`).join('')}</div></div>
        <div class="usernamePopup-actions">
          <button type="button" class="go amber" data-name="settings-ok">确认</button>
          ${back('dismiss','取消')}
          ${named?'<button type="button" class="go danger" data-name="clear">清除账号</button>':''}
        </div>`;
}
// 23:55 Eastern until the new day opens (DATABASE.md, "The day"): no new games and no names
export const lobbyClosing=()=>dayPhase()==='closing'||M.closing;
// MM:SS to midnight; 00:00 once it has passed and the server is still finishing the close
export function closingLabel(){
  const s=dayPhase()==='closing'?Math.ceil(msUntilEasternMidnight()/1000):0,pad=n=>String(n).padStart(2,'0');
  return `${pad(Math.floor(s/60))}:${pad(s%60)}`;
}
// 好友模式: the rooms people are in right now (tap one to join, with its password if it has one), a room code
// to join or create, and the password step when creating. The name is the player's own; the stakes are the lobby's.
const friendsOpen=()=>!M.mode&&NAME_POPUP&&NAME_ASK==='friends';
export function openFriends(){NAME_POPUP=true;NAME_ASK='friends';renderMenu();refreshRooms();}
export function roomsHTML(){
  const list=(LOBBY.rooms||[]).slice();
  // a room reached by its code (or a link) that asked for a password, even if it isn't listed
  if(LOBBY.open&&!list.some(r=>r.code===LOBBY.open))list.unshift({code:LOBBY.open,pw:true,n:0});
  const row=r=>{
    const open=LOBBY.open===r.code;
    return `<div class="room${open?' open':''}">
      <button type="button" class="rrow" data-open-room="${esc(r.code)}" aria-expanded="${open}">
        <span class="rc">${esc(r.code)}</span>${r.pw?'<span class="lock" title="有密码">🔒</span>':''}
        <span class="rm">${[r.online?`${r.online} 人在线`:'',r.n?`${r.n} 人入座`:'',r.sb?`盲注 ${r.sb}/${r.bb}`:'',r.host?`房主 ${esc(r.host)}`:''].filter(Boolean).join(' · ')}</span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
      ${open?`<div class="rjoin${r.pw?'':' nopw'}">
        ${r.pw?'<input id="rjPw" type="password" maxlength="32" placeholder="房间密码" aria-label="房间密码" autocomplete="off">':''}
        <button type="button" class="go teal" data-enter-room="${esc(r.code)}">进入</button>
        ${FLASH?`<p class="why" role="alert">${esc(FLASH)}</p>`:''}
      </div>`:''}
    </div>`;
  };
  return `<div class="rooms-h"><b>房间</b><small>${LOBBY.rooms===null?'加载中…':list.length?'点一下就能进':''}</small></div>
    ${list.length?`<div class="rlist">${list.map(row).join('')}</div>`:LOBBY.rooms===null?'':'<p class="rempty">现在没有开着的房间，在下面创建一个吧。</p>'}`;
}
export function renderRooms(){const el=$('rooms');if(el)el.innerHTML=roomsHTML();}
// the list is fetched when 好友模式 opens, then every 8 s while it stays open
let ROOMS_POLL=null;
export function refreshRooms(){
  fetchRooms().then(list=>{LOBBY.rooms=Array.isArray(list)?list:[];},()=>{LOBBY.rooms=LOBBY.rooms||[];}).then(()=>{
    // don't redraw under someone typing a room's password
    if(friendsOpen()&&!LOBBY.open)renderRooms();
  });
  if(!ROOMS_POLL)ROOMS_POLL=setInterval(()=>{if(friendsOpen()&&M.server&&!document.hidden)refreshRooms();},8000);
}
function friendsHTML(){
  const p=PRESETS[PRESET],why=FLASH&&!LOBBY.open?`<p class="why" role="alert">${esc(FLASH)}</p>`:'';
  if(LOBBY.confirm)return `
        <b id="usernamePopupTitle">创建房间 <span class="code">${esc(LOBBY.confirm.code)}</span></b>
        <p class="name-note">盲注 ${p.sb}/${p.bb} · 最低买入 ${fmt(p.buy)} · 满 2 人开局</p>
        <input id="cpPw" maxlength="32" placeholder="密码（不填就没有密码）" autocomplete="off" aria-label="房间密码">
        ${why}
        <div class="usernamePopup-actions">
          <button type="button" class="go amber" data-confirm-create="1">确认创建</button>
          <button type="button" class="go plain" data-cancel-create="1">返回</button>
        </div>`;
  return `
        <b id="usernamePopupTitle">好友模式</b>
        <section class="rooms" id="rooms" aria-label="房间">${roomsHTML()}</section>
        <input id="roomIn" maxlength="8" placeholder="房间号（创建时不填就随机）" value="${esc(M.prefill||'')}" autocapitalize="characters" autocomplete="off" aria-label="房间号">
        ${why}
        <div class="friend-actions">
          <button type="button" class="go teal" data-room="join">加入房间</button>
          <button type="button" class="go amber" data-room="create">创建房间</button>
        </div>
        <p class="name-note">新房间用大厅选的盲注 ${p.sb}/${p.bb}，每次买入 ${fmt(p.buy)}。</p>
        <div class="usernamePopup-actions"><button type="button" class="go plain" data-name="dismiss">返回</button></div>`;
}
export function renderMenu(){
  const bal=shownBalance();
  const named=!!sessionName(),closing=lobbyClosing();
  const tiles=PRESETS.map((p,i)=>{
    const locked=!named||p.buy>bal||closing;
    const on=!locked&&PRESET===i;
    return `<button type="button" class="stake-tile${on?' on':''}" data-stake="${i}" aria-pressed="${on}"${locked?' disabled':''} aria-label="盲注 ${p.sb}/${p.bb}，最低买入 ${fmt(p.buy)}"><span class="stake-icon">${stakeIcon(p.sb)}</span><b>${p.sb}/${p.bb}</b><small>最低买入 ${fmt(p.buy)}</small></button>`;
  }).join('');
  const boards=SLOTS.map(([k,label])=>{const r=BOARD&&BOARD[k];return `<span class="lb-item"><small>${esc(label)}</small><span>${r?esc(r.name):'暂无'}</span><b>${r?fmt(r.money):'—'}</b></span>`;}).join('');
  const changed=nameChanged();
  const back=(to,label='返回')=>`<button type="button" class="go plain" data-name="${to}">${label}</button>`;
  let ask;
  // 查看数据 opens on the name; tapping the name there is how it changes
  const nameBtn=`<button type="button" class="greet tag" data-name="edit" title="修改名字">${esc(sessionName())}</button>`;
  if(NAME_ASK==='settings')ask=settingsHTML(named,back);
  else if(NAME_ASK==='friends')ask=friendsHTML();
  else if(NAME_ASK==='stats')ask=statsView({tag:nameBtn,data:STATS,card:k=>`data-name="stat:${k}"`,foot:back('dismiss')});
  else if(NAME_ASK.startsWith('stat:'))ask=statView({k:NAME_ASK.slice(5),data:STATS,foot:back('stats')});
  else if(NAME_ASK==='rename')ask=`
        <b id="usernamePopupTitle">修改名字为 ${esc(NAME_NEXT)}？</b>
        <p class="name-note">您只能修改一次名字</p>
        <div class="usernamePopup-actions">
          <button type="button" class="go danger" data-name="rename-ok">确认</button>
          <button type="button" class="go plain" data-name="ask-no">取消</button>
        </div>`;
  else if(NAME_ASK==='clear')ask=`
        <b id="usernamePopupTitle">确认清除账号？</b>
        <p class="name-note">一经确认，您将无法继续使用 ${esc(sessionName())} 游玩。</p>
        <div class="usernamePopup-actions">
          <button type="button" class="go danger" data-name="clear-ok">确认</button>
          <button type="button" class="go plain" data-name="settings">取消</button>
        </div>`;
  else ask=`
        <b id="usernamePopupTitle">${named?'修改名字':'请留尊姓大名'}</b>${!named&&M.prefill?`
        <p class="name-note">留下名字，就能进入房间 ${esc(M.prefill)}</p>`:''}
        <input id="nameIn" maxlength="16" autocomplete="nickname" placeholder="您的名字" value="${esc(NAME_NEXT||sessionName())}">
        <p id="nameErr" class="why" role="alert"></p>
        <div class="usernamePopup-actions">
          <button type="button" class="go amber" data-name="ok"${changed?' disabled':''}>确认</button>
          ${named?back('stats-back','取消'):back('dismiss','以后再说')}
        </div>`;
  const namePopup=NAME_POPUP?`
    <div id="usernamePopup">
      <button type="button" class="usernamePopup-bg" data-name="dismiss" aria-label="关闭"></button>
      <div class="usernamePopup-card" role="dialog" aria-modal="true" aria-labelledby="usernamePopupTitle">${ask}
      </div>
    </div>`:'';
  // a redraw (the board refreshing every 30 s) keeps what was typed in the popup, and the cursor
  const typed={},focus=document.activeElement&&document.activeElement.id;
  for(const id of ['nameIn','roomIn','rjPw','cpPw']){const el=$(id);if(el)typed[id]=el.value;}
  $('menu').innerHTML=`
    <div class="lb" role="marquee" aria-label="排行榜"><div class="lb-track"><div class="lb-run">${boards}${boards}</div><div class="lb-run" aria-hidden="true">${boards}${boards}</div></div></div>
    <div class="hub">
      ${closing
        ? `<div class="bal closing"><button type="button" class="greet" disabled>-</button><b id="dayCountdown">${closingLabel()}</b><span>正在清理牌桌${named?` · 今日余额 ${fmt(bal)}`:''}</span></div>`
        : `<div class="bal"><button type="button" class="greet" data-greet>${named?esc(sessionName()):'请留尊姓大名'}</button><b${named?'':' class="struck"'}>${fmt(bal)}</b>${named?`<span>可用余额 · <span class="when" id="balReset">${resetInLabel()}</span> 后重置</span>`:''}</div>`}
    </div>
    <div class="stakes" role="group" aria-label="盲注">${tiles}</div>
    <p id="lobbyError" class="why" role="alert">${FLASH&&!NAME_POPUP?esc(FLASH):''}</p>
    <button type="button" class="go amber play" data-mode="normal"${named&&!closing?'':' disabled'}>进入游戏</button>
    <div class="side-modes">
      <button type="button" class="go teal play" data-mode="practice">练习模式</button>
      <button type="button" class="go teal play" data-friends="1"${named&&!closing&&M.server?'':' disabled'}>好友模式</button>
    </div>
    <div class="side-modes">
      <button type="button" class="go plain play" data-settings="1">设置</button>
      <button type="button" class="go plain play" data-soon="1">关于</button>
    </div>${namePopup}`;
  for(const id in typed){const el=$(id);if(el)el.value=typed[id];}
  if(focus&&$(focus)&&focus in typed)$(focus).focus();
}
