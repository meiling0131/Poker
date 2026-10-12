// Header and lobby.
import {DAILY_LIMIT} from '../config.js';
import {SOUND} from '../fx.js';
import {BB,PLAY_MODE,SB,SHOW_HAND,dailyAllowance} from '../settings.js';
import {CONFIRM_RESET,FLASH,M,S,VIEW} from '../state.js';
import {$,esc,fmt,store} from '../util.js';

export function renderHeader(){
  const online=M.mode==='online';
  $('pills').innerHTML=!M.mode?'':`<span class="pill">${online?`房间 ${esc(M.room||'')}`:`${PLAY_MODE==='normal'?'正常':'练习'} · 7 人`}</span><span class="pill">盲注 ${SB}/${BB}</span>${S&&S.hand?`<span class="pill">第 ${S.hand} 手</span>`:''}`;
  $('nav').hidden=!M.mode;
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.view===VIEW));
  $('handHints').checked=SHOW_HAND;$('soundOn').checked=SOUND;
  $('speed').hidden=M.mode!=='bots';
  $('restart').hidden=!(M.mode==='bots'||(online&&M.host));
  $('restart').textContent=CONFIRM_RESET?'确认重置？':'重置牌桌';
  $('restart').classList.toggle('warn',CONFIRM_RESET);
  $('menuBtn').hidden=!M.mode;
  $('moreBtn').hidden=!M.mode||($('speed').hidden&&$('restart').hidden&&$('menuBtn').hidden);
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
  const prevNick=esc(M.nick||''),pre=esc(M.prefill||store.get('poker.room')||'');
  $('menu').innerHTML=`
    <div class="lobby-intro"><span class="eyebrow">THE PRIVATE TABLE</span><h2>好朋友，开一桌。</h2><p>坐下来，从这一手开始。</p><div class="lobby-chips" aria-hidden="true"><i class="chip-d w"></i><i class="chip-d r"></i><i class="chip-d b"></i><i class="chip-d g"></i></div></div>
    <section class="lobby-options">
      <div><strong>自定义盲注</strong><span>用于人机与新建好友房 · 每次买入 200</span></div>
      <label>小盲<input id="stakeSB" type="number" inputmode="numeric" min="1" max="99" value="${SB}"></label>
      <label>大盲<input id="stakeBB" type="number" inputmode="numeric" min="2" max="100" value="${BB}"></label>
      <label class="hintToggle"><span>提示我的牌型</span><input data-hand-hints="1" type="checkbox" role="switch"${SHOW_HAND?' checked':''}></label>
    </section>
    <p id="lobbyError" class="why" role="alert"></p>
    <button class="mode normal" data-mode="normal">
      <span class="mk">正常模式</span><span class="mt">每日额度 ${fmt(DAILY_LIMIT)} · 剩余 ${fmt(dailyAllowance().remaining)}</span>
      <span class="md">与 6 位电脑对局。买入累计计入额度，退出和重开不会返还；每天本地时间零点恢复。</span>
      <span class="go">进入牌桌</span>
    </button>
    <button class="mode" data-mode="practice">
      <span class="mk">练习模式</span>
      <span class="mt">7 人 · 你 + 6 个电脑</span>
      <span class="md">不限次数买入，自由练习下注与策略。</span>
      <span class="go">开始</span>
    </button>
    <div class="mode online${canOnline?'':' disabled'}">
      <span class="mk">好友模式</span>
      <span class="mt">5–10 人 · 全是真人</span>
      <span class="md">创建房间，邀请朋友入座。每次买入 200，2–10 人，满 2 人开局。房主需保持页面开启。</span>
      <div class="form">
        <label for="nick">昵称</label><input id="nick" maxlength="16" placeholder="朋友们看到的名字" value="${prevNick}" autocomplete="nickname"${canOnline?'':' disabled'}>
        <label for="roomIn">房间号</label><input id="roomIn" maxlength="8" placeholder="比如 K7Q2M" value="${pre}" autocapitalize="characters" autocomplete="off"${canOnline?'':' disabled'}>
        <div class="formbtns"><button class="btn call" data-room="join"${canOnline?'':' disabled'}>加入房间</button><button class="btn raise" data-room="create"${canOnline?'':' disabled'}>创建房间</button></div>
      </div>
    </div>
    ${why||FLASH?`<p class="why">${why||esc(FLASH)}</p>`:''}`;
}
