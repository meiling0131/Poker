// Top-level render and the 1-second ticker.
import {PENDING_ACTION,cancelAction,pendingIsCurrent,runPre} from '../actions.js';
import {celebrate,keepAwake,turnAlert} from '../fx.js';
import {adoptStake} from '../settings.js';
import {FLASH,M,S,VIEW,setVIEW,view} from '../state.js';
import {renderHero} from './hero-view.js';
import {closingLabel,renderHeader,renderMenu,setBoard} from './menu-view.js';
import {fetchBoard} from '../player.js';
import {renderRecords} from './records-view.js';
import {renderProfile,renderTable} from './table-view.js';
import {$,dayPhase,easternDay,esc,resetInLabel,secsLeft} from '../util.js';

// 超时牌桌: shown once per overtime hand, to everyone at the table, until 确认
let OVERTIME_SEEN='';
const overtimeKey=()=>S&&S.overtime&&M.mode?`${M.room}:${S.hand}`:'';
export function dismissOvertime(){OVERTIME_SEEN=overtimeKey();render();}
export function render(){
  adoptStake();keepAwake();
  const ot=$('overtimePopup');if(ot){const k=overtimeKey();ot.hidden=!k||k===OVERTIME_SEEN;}
  if(PENDING_ACTION&&!pendingIsCurrent())cancelAction();
  if(VIEW==='records'&&M.mode!=='online')setVIEW('table');   // 记录 is only open in a friends room
  document.body.dataset.view=M.mode?VIEW:'menu';
  renderHeader();
  if(!M.mode){renderProfile();renderMenu();return;}
  if(!S){
    const msg=!M.ready?'正在等待连接...':M.mode==='online'?'正在等待玩家...':'正在等待开局...';
    $('table').innerHTML=`<div class="center"><div class="result">${msg}</div></div>`;
    $('meSeat').innerHTML='';
    $('hero').innerHTML=FLASH?`<div class="flash">${esc(FLASH)}</div>`:'';
    $('records').innerHTML='';return;
  }
  runPre();turnAlert();celebrate();
  if(VIEW==='records'){renderRecords();tick();return;}
  renderTable();renderHero();
  tick();
}
export let DISPLAY_DAY=easternDay();
let DISPLAY_PHASE=dayPhase(),POLL_AT=0,BOARD_AT=0;
export function tick(){
  document.querySelectorAll('[data-bubble-until]').forEach(e=>{if(+e.dataset.bubbleUntil<Date.now())e.remove();});
  const day=easternDay();if(day!==DISPLAY_DAY){DISPLAY_DAY=day;render();return;}
  // 23:55 and 00:00: ask the server where the day stands; while it is still closing, ask again every 10 s
  const phase=dayPhase();
  if(phase!==DISPLAY_PHASE){DISPLAY_PHASE=phase;if(view.refreshPlayer)view.refreshPlayer();render();return;}
  if(M.closing&&phase!=='closing'&&Date.now()>POLL_AT){POLL_AT=Date.now()+10000;if(view.refreshPlayer)view.refreshPlayer();}
  // the lobby's board: on arrival, then every 30 s while the lobby is open
  if(!M.mode&&M.server&&Date.now()>BOARD_AT){BOARD_AT=Date.now()+30000;fetchBoard().then(b=>{if(b&&setBoard(b)&&!M.mode)renderMenu();}).catch(()=>{});}
  const cd=$('dayCountdown');if(cd)cd.textContent=closingLabel();
  const reset=$('balReset');if(reset) reset.textContent=resetInLabel();
  document.querySelectorAll('[data-until]').forEach(e=>{e.textContent=secsLeft(e.dataset.until);});
}
setInterval(tick,1000);
view.render=render;
