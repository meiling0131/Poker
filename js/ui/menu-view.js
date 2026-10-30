// Header and lobby.
import {PLAY_MODE,PRESET,PRESETS,SB,BB,SKINS} from '../settings.js';
import {FLASH,LOBBY,M,S,VIEW} from '../state.js';
import {displayName} from '../player.js';
import {fetchRooms} from '../net.js';
import {eval5,handName} from '../cards.js';
import {cardHTML} from './table-view.js';
import {$,dayPhase,esc,fmt,msUntilEasternMidnight,resetInLabel} from '../util.js';
import {LANGS,N_,tr} from '../i18n.js';

let NAME_POPUP=false,NAME_ASK='',NAME_NEXT='';
let SHOWN_ASK=null;   // the popup on screen, so a redraw of the same one keeps where it was scrolled to
// the board from /leaderboard; setBoard says whether it changed (the banner is only redrawn then)
let BOARD=null;
export function setBoard(b){const same=JSON.stringify(b)===JSON.stringify(BOARD);BOARD=b;return !same;}
const SLOTS=[['today',N_('今日最佳')],['yesterday',N_('昨日最佳')],['week',N_('本周最佳')],['month',N_('本月最佳')],['all_time',N_('历史最佳')]];
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
  $('pills').innerHTML=!M.mode?'':`<span class="pill">${online?tr('房间 {code}',{code:esc(M.room||'')}):(PLAY_MODE==='normal'?tr('正常 · 7 人'):tr('练习 · 7 人'))}</span><span class="pill">${tr('盲注 {sb}/{bb}',{sb:SB,bb:BB})}</span>${S&&S.hand?`<span class="pill">${tr('第 {n} 手',{n:S.hand})}</span>`:''}`;
  $('nav').hidden=!M.mode;
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.view===VIEW));
  // 记录 is open in a friends room: the invite link, the players (the owner can remove them) and the ledger
  const rec=document.querySelector('#nav [data-view="records"]');
  if(rec){rec.disabled=!online;rec.title=online?'':tr('暂未开放');}
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
  {k:'hands',zh:N_('手数'),about:N_('今天发到你手里的总手数。')},
  {k:'hands_won',zh:N_('赢的手数'),about:N_('今天赢得至少一个底池的手数，平分也算。')},
];
const STAT_CARDS=[
  {k:'vpip',en:'VPIP',zh:N_('入池率'),num:'vpip',den:'hands',denLbl:N_('手'),pct:'vpip_pct',about:N_('翻牌前主动把筹码放进底池（跟注或加注，盲注不算）的手数，占所有手数的比例。越高说明玩得越松。')},
  {k:'pfr',en:'PFR',zh:N_('翻前加注率'),num:'pfr',den:'hands',denLbl:N_('手'),pct:'pfr_pct',about:N_('翻牌前加注的手数，占所有手数的比例。和入池率越接近，打法越凶。')},
  {k:'ats',en:'ATS',zh:N_('偷盲率'),num:'ats',den:'ats_opp',denLbl:N_('次机会'),pct:'ats_pct',about:N_('坐在关煞位、庄位或小盲位，而且前面所有人都弃牌时，选择加注的比例。')},
  {k:'3bet',en:'3BET',zh:N_('再加注率'),num:'3bet',den:'hands',denLbl:N_('手'),pct:'3bet_pct',about:N_('翻牌前面对一次开局加注时再加注的次数，占所有手数的比例。')},
  {k:'wtsd',en:'WTSD',zh:N_('摊牌率'),num:'wtsd',den:'saw_flop',denLbl:N_('次看翻牌'),about:N_('看到翻牌之后，一直坚持到摊牌的比例。')},
  {k:'wsd',en:'WSD',zh:N_('摊牌胜率'),num:'wsd',den:'wtsd',denLbl:N_('次摊牌'),pct:'wsd_pct',about:N_('进入摊牌后赢得底池的比例。平分也算赢。')},
  {k:'wwsf',en:'WWSF',zh:N_('翻后胜率'),num:'wwsf',den:'saw_flop',denLbl:N_('次看翻牌'),pct:'wwsf_pct',about:N_('看到翻牌后最终赢得底池的比例，包括对手弃牌让你赢。')},
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
  if(!amt)return `<div class="stat-best"><small>${tr('最大赢池')}</small><p class="name-note">${tr('今天还没有赢过底池。')}</p></div>`;
  const cards=codes.map(x=>CODE_R.indexOf(x[0])>=0&&CODE_S.indexOf(x[1])>=0?CODE_S.indexOf(x[1])*13+CODE_R.indexOf(x[0]):null);
  const shown=cards.length===5&&cards.every(c=>c!=null);
  return `<div class="stat-best"><small>${tr('最大赢池')}</small><b>${fmt(amt)}</b>
          <div class="stat-hand">${(shown?cards:[null,null,null,null,null]).map(c=>cardHTML(c,'bigwin')).join('')}</div>
          <span>${shown?tr(handName(eval5(...cards))):tr('对手弃牌，未亮牌')}</span></div>`;
}
// The stats popup, shared by the lobby's 查看数据 and a player's card at the table.
// data: the stats (undefined while loading, null before the first hand, 'error'); card(k): the attributes a card
// opens its explanation with; foot: the buttons at the bottom; note: the line above the cards' counts;
// about: a line under the name (a bot's avatar and how it plays).
export function statsView({tag,data,card,foot,today=true,about=''}){
  const body=data===undefined?`<p class="name-note">${tr('正在读取…')}</p>`
    :data==='error'?`<p class="name-note">${tr('没能读取数据，请稍后再试。')}</p>`
    :`<div class="stat-grid">${COUNT_CARDS.map(c=>`<button type="button" class="stat-card" ${card(c.k)}><b>${fmt(data?data[c.k]||0:0)}</b><small>${tr(c.zh)}</small></button>`).join('')}</div>
        ${bestHandHTML(data)}
        <div class="stat-grid">${STAT_CARDS.map(c=>`<button type="button" class="stat-card" ${card(c.k)}><b>${pctOf(c,data)}</b><span>${c.en}</span><small>${tr(c.zh)}</small></button>`).join('')}</div>
        ${data?'':`<p class="name-note">${tr('打完第一手后开始统计。')}</p>`}${today?'':`<p class="name-note">${tr('练习模式：本次练习的数据，不计入排行。')}</p>`}`;
  return `
        <div id="usernamePopupTitle" class="popup-tag">${tag}</div>${about}${body}
        <div class="usernamePopup-actions">${foot}</div>`;
}
export function statView({k,data,foot,today=true}){
  const count=COUNT_CARDS.find(x=>x.k===k);
  if(count){
    const share=data&&data.hands?Math.round((data.hands_won||0)*100/data.hands):0;
    const extra=k==='hands_won'&&data&&data.hands?`<p class="name-note">${(today?tr('占今日手数的 {p}%',{p:share}):tr('占本次练习手数的 {p}%',{p:share}))}</p>`:'';
    return `
        <b id="usernamePopupTitle">${tr(count.zh)}</b>
        <p class="stat-big">${fmt(data?data[k]||0:0)}</p>
        <p class="name-note">${tr(count.about)}</p>${extra}
        <div class="usernamePopup-actions">${foot}</div>`;
  }
  const c=STAT_CARDS.find(x=>x.k===k)||STAT_CARDS[0],n=data?data[c.num]||0:0,dn=data?data[c.den]||0:0,of={n:fmt(n),d:fmt(dn),u:tr(c.denLbl)};
  return `
        <b id="usernamePopupTitle">${c.en} · ${tr(c.zh)}</b>
        <p class="stat-big">${pctOf(c,data)}</p>
        <p class="name-note">${tr(c.about)}</p>
        <p class="name-note">${(today?tr('今日：{n} / {d} {u}',of):tr('本次练习：{n} / {d} {u}',of))}</p>
        <div class="usernamePopup-actions">${foot}</div>`;
}
// 设置: changes are a draft until 确认. sound: every sound effect (游戏音效); speed: how long a bot thinks (ms);
// skin: which floor's table (牌桌).
export const SPEEDS=[[1100,N_('较慢')],[650,N_('中等')],[250,N_('较快')]];
let DRAFT={sound:true,speed:650,skin:'f1',lang:'zh'};
export function setSettingsDraft(d){DRAFT=Object.assign({},DRAFT,d);}
export function settingsDraft(){return DRAFT;}
function settingsHTML(named,back){
  return `
        <b id="usernamePopupTitle">${tr('设置')}</b>
        <div class="set-row"><span>${tr('语言')}</span><div class="seg">${LANGS.map(([k,l])=>`<button type="button" data-set-lang="${k}" lang="${k==='en'?'en':'zh-CN'}"${DRAFT.lang===k?' class="on"':''}>${l}</button>`).join('')}</div></div>
        <div class="set-row"><span>${tr('游戏音效')}</span><div class="seg">${[[false,N_('关闭§off')],[true,N_('启用')]].map(([v,l])=>`<button type="button" data-set-sound="${v?1:0}"${DRAFT.sound===v?' class="on"':''}>${tr(l)}</button>`).join('')}</div></div>
        <div class="set-row"><span>${tr('机器人速度')}</span><div class="seg">${SPEEDS.map(([v,l])=>`<button type="button" data-set-speed="${v}"${DRAFT.speed===v?' class="on"':''}>${tr(l)}</button>`).join('')}</div></div>
        <div class="set-row"><span>${tr('牌桌')}</span><div class="seg">${SKINS.map(([k,l,d])=>`<button type="button" data-set-skin="${k}" title="${tr(d)}"${DRAFT.skin===k?' class="on"':''}>${tr(l)}</button>`).join('')}</div></div>
        <div class="usernamePopup-actions">
          <button type="button" class="go amber" data-name="settings-ok">${tr('确认')}</button>
          ${back('dismiss',tr('取消'))}
          ${named?`<button type="button" class="go danger" data-name="clear">${tr('清除账号')}</button>`:''}
        </div>`;
}
// 关于: what the game is and how a day goes
const ABOUT=[
  [N_('每天 1,000'),N_('每人每天有 1,000 余额，美东时间午夜重置；第二天重新留名，从 1,000 开始。')],
  [N_('进入游戏'),N_('选一个盲注（1/2、2/5、5/10），和六个风格各异的机器人同桌。买入、下注和每一次输赢都记在服务器上，计入排行榜。')],
  [N_('练习模式'),N_('用练习筹码随便打，不记录，也不计入排行。')],
  [N_('好友模式'),N_('创建或加入房间（可以设密码），在「记录」里把邀请链接发给朋友，满 2 人开局。')],
  [N_('排行榜'),N_('今日、昨日、本周、本月和历史最佳，比的是余额加上桌上的筹码。')],
  [N_('查看数据'),N_('在大厅点自己的名字，看今天的数据；在牌桌上点任意座位，看那位玩家的数据。')],
  [N_('每天收桌'),N_('美东时间 23:55 起不再开新牌局；到 00:05 还没打完的牌局会取消，下注全部退回。')],
  [N_('添加到主屏幕'),N_('iPhone 在 Safari 里点「分享 → 添加到主屏幕」，安卓在 Chrome 菜单里选「添加到主屏幕」，之后就能像 App 一样全屏打开。')],
];
function aboutHTML(){
  return `
        <b id="usernamePopupTitle">${tr('关于 Verve Poker')}</b>
        <div class="about">
          <p>${tr('Verve Poker 是为手机设计的无限注德州扑克，打开网页就能玩，不用下载安装。')}</p>
          <dl>${ABOUT.map(([k,v])=>`<div><dt>${tr(k)}</dt><dd>${tr(v)}</dd></div>`).join('')}</dl>
        </div>
        <div class="usernamePopup-actions"><button type="button" class="go plain" data-name="dismiss">${tr('返回')}</button></div>`;
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
        <span class="rc">${esc(r.code)}</span>${r.pw?`<span class="lock" title="${tr('有密码')}">🔒</span>`:''}
        <span class="rm">${[r.online?tr('{n} 人在线',{n:r.online}):'',r.n?tr('{n} 人入座',{n:r.n}):'',r.sb?tr('盲注 {sb}/{bb}',{sb:r.sb,bb:r.bb}):'',r.host?tr('房主 {name}',{name:esc(r.host)}):''].filter(Boolean).join(' · ')}</span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
      ${open?`<div class="rjoin${r.pw?'':' nopw'}">
        ${r.pw?`<input id="rjPw" type="password" maxlength="32" placeholder="${tr('房间密码')}" aria-label="${tr('房间密码')}" autocomplete="off">`:''}
        <button type="button" class="go teal" data-enter-room="${esc(r.code)}">${tr('进入')}</button>
        ${FLASH?`<p class="why" role="alert">${esc(FLASH)}</p>`:''}
      </div>`:''}
    </div>`;
  };
  return `<div class="rooms-h"><b>${tr('房间')}</b><small>${LOBBY.rooms===null?tr('加载中…'):list.length?tr('点一下就能进'):''}</small></div>
    ${list.length?`<div class="rlist">${list.map(row).join('')}</div>`:LOBBY.rooms===null?'':`<p class="rempty">${tr('现在没有开着的房间，在下面创建一个吧。')}</p>`}`;
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
        <b id="usernamePopupTitle">${tr('创建房间 {code}',{code:`<span class="code">${esc(LOBBY.confirm.code)}</span>`})}</b>
        <p class="name-note">${tr('盲注 {sb}/{bb} · 最低买入 {buy} · 满 2 人开局',{sb:p.sb,bb:p.bb,buy:fmt(p.buy)})}</p>
        <input id="cpPw" maxlength="32" placeholder="${tr('密码（不填就没有密码）')}" autocomplete="off" aria-label="${tr('房间密码')}">
        ${why}
        <div class="usernamePopup-actions">
          <button type="button" class="go amber" data-confirm-create="1">${tr('确认创建')}</button>
          <button type="button" class="go plain" data-cancel-create="1">${tr('返回')}</button>
        </div>`;
  return `
        <b id="usernamePopupTitle">${tr('好友模式')}</b>
        <section class="rooms" id="rooms" aria-label="${tr('房间')}">${roomsHTML()}</section>
        <input id="roomIn" maxlength="8" placeholder="${tr('房间号（创建时不填就随机）')}" value="${esc(M.prefill||'')}" autocapitalize="characters" autocomplete="off" aria-label="${tr('房间号')}">
        ${why}
        <div class="friend-actions">
          <button type="button" class="go teal" data-room="join">${tr('加入房间')}</button>
          <button type="button" class="go amber" data-room="create">${tr('创建房间')}</button>
        </div>
        <p class="name-note">${tr('新房间用大厅选的盲注 {sb}/{bb}，每次买入 {buy}。',{sb:p.sb,bb:p.bb,buy:fmt(p.buy)})}</p>
        <div class="usernamePopup-actions"><button type="button" class="go plain" data-name="dismiss">${tr('返回')}</button></div>`;
}
export function renderMenu(){
  const bal=shownBalance();
  const named=!!sessionName(),closing=lobbyClosing();
  const tiles=PRESETS.map((p,i)=>{
    const locked=!named||p.buy>bal||closing;
    const on=!locked&&PRESET===i;
    return `<button type="button" class="stake-tile${on?' on':''}" data-stake="${i}" aria-pressed="${on}"${locked?' disabled':''} aria-label="${tr('盲注 {sb}/{bb}，最低买入 {buy}',{sb:p.sb,bb:p.bb,buy:fmt(p.buy)})}"><span class="stake-icon">${stakeIcon(p.sb)}</span><b>${p.sb}/${p.bb}</b><small>${tr('最低买入 {buy}',{buy:fmt(p.buy)})}</small></button>`;
  }).join('');
  const boards=SLOTS.map(([k,label])=>{const r=BOARD&&BOARD[k];return `<span class="lb-item"><small>${esc(tr(label))}</small><span>${r?esc(r.name):tr('暂无')}</span><b>${r?fmt(r.money):'—'}</b></span>`;}).join('');
  const changed=nameChanged();
  const back=(to,label=tr('返回'))=>`<button type="button" class="go plain" data-name="${to}">${label}</button>`;
  let ask;
  // 查看数据 opens on the name; tapping the name there is how it changes
  const nameBtn=`<button type="button" class="greet tag" data-name="edit" title="${tr('修改名字')}">${esc(sessionName())}</button>`;
  if(NAME_ASK==='settings')ask=settingsHTML(named,back);
  else if(NAME_ASK==='about')ask=aboutHTML();
  else if(NAME_ASK==='friends')ask=friendsHTML();
  else if(NAME_ASK==='stats')ask=statsView({tag:nameBtn,data:STATS,card:k=>`data-name="stat:${k}"`,foot:back('dismiss')});
  else if(NAME_ASK.startsWith('stat:'))ask=statView({k:NAME_ASK.slice(5),data:STATS,foot:back('stats')});
  else if(NAME_ASK==='rename')ask=`
        <b id="usernamePopupTitle">${tr('修改名字为 {name}？',{name:esc(NAME_NEXT)})}</b>
        <p class="name-note">${tr('您只能修改一次名字')}</p>
        <div class="usernamePopup-actions">
          <button type="button" class="go danger" data-name="rename-ok">${tr('确认')}</button>
          <button type="button" class="go plain" data-name="ask-no">${tr('取消')}</button>
        </div>`;
  else if(NAME_ASK==='clear')ask=`
        <b id="usernamePopupTitle">${tr('确认清除账号？')}</b>
        <p class="name-note">${tr('一经确认，您将无法继续使用 {name} 游玩。',{name:esc(sessionName())})}</p>
        <div class="usernamePopup-actions">
          <button type="button" class="go danger" data-name="clear-ok">${tr('确认')}</button>
          <button type="button" class="go plain" data-name="settings">${tr('取消')}</button>
        </div>`;
  else ask=`
        <b id="usernamePopupTitle">${(named?tr('修改名字'):tr('请留尊姓大名'))}</b>${!named&&M.prefill?`
        <p class="name-note">${tr('留下名字，就能进入房间 {code}',{code:esc(M.prefill)})}</p>`:''}
        <input id="nameIn" maxlength="16" autocomplete="nickname" placeholder="${tr('您的名字')}" value="${esc(NAME_NEXT||sessionName())}">
        <p id="nameErr" class="why" role="alert"></p>
        <div class="usernamePopup-actions">
          <button type="button" class="go amber" data-name="ok"${changed?' disabled':''}>${tr('确认')}</button>
          ${named?back('stats-back',tr('取消')):back('dismiss',tr('以后再说'))}
        </div>`;
  const namePopup=NAME_POPUP?`
    <div id="usernamePopup">
      <button type="button" class="usernamePopup-bg" data-name="dismiss" aria-label="${tr('关闭')}"></button>
      <div class="usernamePopup-card" role="dialog" aria-modal="true" aria-labelledby="usernamePopupTitle">${ask}
      </div>
    </div>`:'';
  // a redraw (the board refreshing every 30 s) keeps what was typed in the popup, and the cursor
  const typed={},focus=document.activeElement&&document.activeElement.id;
  for(const id of ['nameIn','roomIn','rjPw','cpPw']){const el=$(id);if(el)typed[id]=el.value;}
  const card=document.querySelector('#usernamePopup .usernamePopup-card'),scrolled=card&&SHOWN_ASK===NAME_ASK?card.scrollTop:0;
  SHOWN_ASK=NAME_POPUP?NAME_ASK:null;
  $('menu').innerHTML=`
    <div class="lb" role="marquee" aria-label="${tr('排行榜')}"><div class="lb-track"><div class="lb-run">${boards}${boards}</div><div class="lb-run" aria-hidden="true">${boards}${boards}</div></div></div>
    <div class="hub">
      ${closing
        ? `<div class="bal closing"><button type="button" class="greet" disabled>-</button><b id="dayCountdown">${closingLabel()}</b><span>${tr('正在清理牌桌')}${named?` · ${tr('今日余额 {n}',{n:fmt(bal)})}`:''}</span></div>`
        : `<div class="bal"><button type="button" class="greet" data-greet>${named?esc(sessionName()):tr('请留尊姓大名')}</button><b${named?'':' class="struck"'}>${fmt(bal)}</b>${named?`<span>${tr('可用余额 · {t} 后重置',{t:`<span class="when" id="balReset">${resetInLabel()}</span>`})}</span>`:''}</div>`}
    </div>
    <div class="stakes" role="group" aria-label="${tr('盲注')}">${tiles}</div>
    <p id="lobbyError" class="why" role="alert">${FLASH&&!NAME_POPUP?esc(FLASH):''}</p>
    <button type="button" class="go amber play" data-mode="normal"${named&&!closing?'':' disabled'}>${tr('进入游戏')}</button>
    <div class="side-modes">
      <button type="button" class="go teal play" data-mode="practice">${tr('练习模式')}</button>
      <button type="button" class="go teal play" data-friends="1"${named&&!closing&&M.server?'':' disabled'}>${tr('好友模式')}</button>
    </div>
    <div class="side-modes">
      <button type="button" class="go plain play" data-settings="1">${tr('设置')}</button>
      <button type="button" class="go plain play" data-about="1">${tr('关于')}</button>
    </div>${namePopup}`;
  for(const id in typed){const el=$(id);if(el)el.value=typed[id];}
  if(focus&&$(focus)&&focus in typed)$(focus).focus();
  if(scrolled){const c=document.querySelector('#usernamePopup .usernamePopup-card');if(c)c.scrollTop=scrolled;}
}
