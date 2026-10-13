// Header and lobby.
import {DAILY_LIMIT} from '../config.js';
import {SOUND} from '../fx.js';
import {BB,PLAY_MODE,SB,SHOW_HAND,dailyAllowance} from '../settings.js';
import {fetchRooms} from '../net.js';
import {CONFIRM_RESET,FLASH,LOBBY,M,S,VIEW} from '../state.js';
import {$,esc,fmt} from '../util.js';
import {isOwner} from '../table.js';

export function renderHeader(){
  const online=M.mode==='online';
  $('pills').innerHTML=!M.mode?'':`<span class="pill">${online?`房间 ${esc(M.room||'')}`:`${PLAY_MODE==='normal'?'正常':'练习'} · 7 人`}</span><span class="pill">盲注 ${SB}/${BB}</span>${S&&S.hand?`<span class="pill">第 ${S.hand} 手</span>`:''}`;
  $('nav').hidden=!M.mode;
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.view===VIEW));
  $('handHints').checked=SHOW_HAND;$('soundOn').checked=SOUND;
  $('speed').hidden=M.mode!=='bots';
  $('restart').hidden=!(M.mode==='bots'||(online&&isOwner()));
  $('restart').textContent=CONFIRM_RESET?'确认重置？':'重置牌桌';
  $('restart').classList.toggle('warn',CONFIRM_RESET);
  $('homeBtn').hidden=!M.mode;
  $('moreBtn').hidden=!M.mode;
  if(!M.mode){$('more').hidden=true;}
  const away=$('away');if(away&&!online)away.hidden=true;
}
export function renderMenu(){
  const canOnline=!!(M.db&&M.uid&&crypto.subtle);
  let why='';
  if(!M.booted)why='正在连接联机服务…';
  else if(M.fbError==='noconfig')why='联机还没配置：请在这个 HTML 文件顶部填好 Firebase 配置。';
  else if(M.fbError==='nosdk')why='没能加载 Firebase。请检查网络，或确认页面是通过 https 网址打开的（不是直接双击本地文件）。';
  else if(M.fbError)why=`联机服务连接失败（${esc(M.fbError)}）。请确认 Firebase 已开启「匿名登录」，并把这个网站的域名加进了已授权网域。`;
  else if(!crypto.subtle)why='这个浏览器环境不支持加密功能，请用 https 网址打开。';
  const prevNick=esc(M.nick||''),pre=esc(M.prefill||'');
  const dis=canOnline?'':' disabled';
  const msg=why||(!LOBBY.open&&FLASH?esc(FLASH):'');
  $('menu').innerHTML=`
    ${M.server?'<section class="rooms" id="rooms" aria-label="房间"></section>':''}
    <section class="lobby-options">
      <div class="stake"><b>盲注</b><input id="stakeSB" aria-label="小盲" type="number" inputmode="numeric" min="1" max="99" value="${SB}"><i>/</i><input id="stakeBB" aria-label="大盲" type="number" inputmode="numeric" min="2" max="100" value="${BB}"><small>每次买入 200</small></div>
      <label class="hintToggle"><span>牌型提示</span><input data-hand-hints="1" type="checkbox" role="switch"${SHOW_HAND?' checked':''}></label>
    </section>
    <p id="lobbyError" class="why" role="alert"></p>
    <div class="lobby-bottom">
    <div class="modes">
      <button class="mode normal" data-mode="normal">
        <span class="mk">正常模式</span><span class="mt">今日剩余 ${fmt(dailyAllowance().remaining)}</span>
        <span class="md">对战 6 个电脑。每日额度 ${fmt(DAILY_LIMIT)}，零点恢复。</span>
        <span class="go amber">进入牌桌</span>
      </button>
      <button class="mode practice" data-mode="practice">
        <span class="mk">练习模式</span><span class="mt">不限买入</span>
        <span class="md">对战 6 个电脑，随便练。</span>
        <span class="go teal">开始练习</span>
      </button>
    </div>
    <div class="mode online${canOnline?'':' disabled'}">
      <div class="mh"><span class="mk">好友模式</span><span class="mt">2–10 人 · 全是真人</span></div>
      <span class="md">自己起房间号，发给朋友。满 2 人开局，每次买入 200。${M.server?'':'房主需保持页面开启。'}</span>
      <div class="form">${LOBBY.confirm?`
        <div class="confirm">
          <p>创建房间 <b class="code">${esc(LOBBY.confirm.code)}</b><span>${prevNick}</span></p>
          <label>密码<input id="cpPw" maxlength="32" placeholder="不填就没有密码" autocomplete="off"></label>
          <button class="go plain" data-cancel-create="1">取消</button><button class="go amber" data-confirm-create="1">确认创建</button>
        </div>`:`
        <label>昵称<input id="nick" maxlength="16" placeholder="朋友们看到的名字" value="${prevNick}" autocomplete="nickname"${dis}></label>
        <label>房间号<input id="roomIn" maxlength="8" placeholder="不填就随机" value="${pre}" autocapitalize="characters" autocomplete="off"${dis}></label>
        <button class="go teal" data-room="join"${dis}>加入房间</button><button class="go amber" data-room="create"${dis}>创建房间</button>`}
      </div>
      ${msg?`<p class="why">${msg}</p>`:''}
    </div>
    </div>`;
  if(M.server){renderRooms();if(Date.now()-lastFetch>3000)refreshRooms();}
}

// ---- room list: rooms people are in right now, refreshed while the lobby is open ----
let lastFetch=0,polling=null;
function refreshRooms(){
  lastFetch=Date.now();
  fetchRooms().then(list=>{LOBBY.rooms=list;},()=>{LOBBY.rooms=LOBBY.rooms||[];}).then(()=>{
    // don't redraw under someone typing a name or password into an opened room
    if(!M.mode&&!LOBBY.open)renderRooms();
  });
  if(!polling)polling=setInterval(()=>{if(!M.mode&&M.server&&!document.hidden)refreshRooms();},8000);
}
export function renderRooms(){
  const el=$('rooms');if(!el)return;
  const list=(LOBBY.rooms||[]).slice();
  // a room reached by its code (or a link) that asked for a password, even if it isn't listed
  if(LOBBY.open&&!list.some(r=>r.code===LOBBY.open))list.unshift({code:LOBBY.open,pw:true,n:0});
  const nick=esc(M.nick||'');
  const row=r=>{
    const open=LOBBY.open===r.code;
    return `<div class="room${open?' open':''}">
      <button class="rrow" data-open-room="${esc(r.code)}" aria-expanded="${open}">
        <span class="rc">${esc(r.code)}</span>${r.pw?'<span class="lock" title="有密码">🔒</span>':''}
        <span class="rm">${[r.online?`${r.online} 人在线`:'',r.n?`${r.n} 人入座`:'',r.sb?`盲注 ${r.sb}/${r.bb}`:'',r.host?`房主 ${esc(r.host)}`:''].filter(Boolean).join(' · ')}</span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
      ${open?`<div class="rjoin${r.pw?'':' nopw'}">
        <input id="rjName" maxlength="16" placeholder="你的名字" aria-label="你的名字" value="${nick}" autocomplete="nickname">
        ${r.pw?'<input id="rjPw" type="password" maxlength="32" placeholder="房间密码" aria-label="房间密码" autocomplete="off">':''}
        <button class="go teal" data-enter-room="${esc(r.code)}">进入</button>
        ${FLASH?`<p class="why">${esc(FLASH)}</p>`:''}
      </div>`:''}
    </div>`;
  };
  el.innerHTML=`<div class="rooms-h"><b>房间</b><small>${LOBBY.rooms===null?'加载中…':list.length?'点一下就能进':''}</small></div>
    ${list.length?`<div class="rlist">${list.map(row).join('')}</div>`:LOBBY.rooms===null?'':'<p class="rempty">现在没有开着的房间，在下面创建一个吧。</p>'}`;
}
