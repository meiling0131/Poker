// Top-level render and the 1-second ticker.
import {PENDING_ACTION,cancelAction,pendingIsCurrent,runPre} from '../actions.js';
import {BETTING} from '../config.js';
import {celebrate,keepAwake,turnAlert} from '../fx.js';
import {adoptStake} from '../settings.js';
import {FLASH,M,S,VIEW,view} from '../state.js';
import {renderHero} from './hero-view.js';
import {renderHeader,renderMenu} from './menu-view.js';
import {renderRecords} from './records-view.js';
import {renderTable} from './table-view.js';
import {$,esc,localDay} from '../util.js';

export function render(){
  adoptStake();keepAwake();
  if(PENDING_ACTION&&!pendingIsCurrent())cancelAction();
  document.body.dataset.view=M.mode?VIEW:'menu';
  renderHeader();
  if(!M.mode){renderMenu();return;}
  if(!S){
    $('table').innerHTML=`<div class="center"><div class="result">${M.ready?`房间 ${esc(M.room||'')} 还没开，或者房主不在线。<br>确认房间号没错，等房主打开就会自动出现。`:'正在连接牌桌…'}</div></div>`;
    $('meSeat').innerHTML='';
    $('hero').innerHTML=`<div class="wait">${M.ready?'牌桌还没开。':'连接中…'}${FLASH?`<br>${esc(FLASH)}`:''}</div>`;
    $('records').innerHTML='';return;
  }
  runPre();turnAlert();celebrate();
  if(VIEW==='records'){renderRecords();tick();return;}
  renderTable();renderHero();
  tick();
}
export let DISPLAY_DAY=localDay();
export function tick(){
  document.querySelectorAll('[data-bubble-until]').forEach(e=>{if(+e.dataset.bubbleUntil<Date.now())e.remove();});
  const day=localDay();if(day!==DISPLAY_DAY){DISPLAY_DAY=day;render();return;}
  document.querySelectorAll('[data-until]').forEach(e=>{const s=Math.max(0,Math.ceil((+e.dataset.until-Date.now())/1000));e.textContent=s+'s';});
  const away=$('away');
  if(S&&M.mode==='online'&&!M.host&&!M.server){
    const stale=Date.now()-(S.updated||0)>20000;
    const ownerTurn=BETTING.includes(S.street)&&S.seats[S.actor]&&S.seats[S.actor].uid===S.ownerUid;
    away.hidden=!(stale&&!ownerTurn&&S.street!=='idle');
  }else away.hidden=true;
}
setInterval(tick,1000);
view.render=render;
