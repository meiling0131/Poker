// Your station: cards, chip rail, bet zone, and action buttons.
import {AUTO_TIDY,BET_MENU,PRE,actionLabels,adjustMoney,autoTidy,cancelAction,layoutRaiseMarks,layoutScaleTicks,preOptions,raiseScale,scalePoint,stillMyTurn} from '../actions.js';
import {CCLS,DV,Z,chipsOf25,csum} from '../chips.js';
import {BETTING,BUY,ONLINE_MAX} from '../config.js';
import {FLASH,M,MYDOC,PUSH,PUSH_TURN,S,SESSION,SUBMITTED,VOTED,setPUSH,setPUSH_TURN,view} from '../state.js';
import {canAct,handLive,isKicked,isOwner,lockedIn,myName,mySeat,myTurn} from '../table.js';
import {EMOJIS,EMO_OPEN} from '../talk.js';
import {chipEl,miniStackC,pilesC} from './chips-view.js';
import {HOT,betHTML,bubbleHTML,cardHTML,myHoleCards,ringHTML,seatName} from './table-view.js';
import {after,dealCard} from './anim.js';
import {sfx} from '../fx.js';
import {tableCash} from './menu-view.js';
import {$,cdSpan,esc,fmt} from '../util.js';

export function hostRequestsHTML(){
  if(!isOwner()||!S||S.mode!=='online')return '';
  const asks=S.seats.filter(p=>p.askB>0);
  if(!asks.length)return '';
  return `<div class="requests">${asks.map(p=>`<div class="req"><span><b>${esc(seatName(p))}</b> 申请买一手 +${fmt(BUY)}${p.askB>1?` ×${p.askB}`:''}</span>
    <button class="mini" data-deny="${esc(p.uid)}">拒绝</button><button class="mini ok" data-approve="${esc(p.uid)}">同意</button></div>`).join('')}</div>`;
}
export function towerHTML(d,count,enabled,pushed){
  const c=CCLS[d],shown=Math.min(count,12);
  return `<button class="tower ${c}" data-push="${d}"${enabled&&count>0?'':' disabled'} aria-label="${d} 面值，剩 ${count} 枚">
    <span class="tw">${'<i class="disc"></i>'.repeat(shown)}${count?'<span class="face"><i class="chip-d '+c+'"></i></span>':'<span class="emptyspot"></span>'}</span>
    <span class="cnt">×${count}</span></button>`;
}
const BANK_ICON=`<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" class="bi bi-cash-coin" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M11 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8m5-4a5 5 0 1 1-10 0 5 5 0 0 1 10 0"/><path d="M9.438 11.944c.047.596.518 1.06 1.363 1.116v.44h.375v-.443c.875-.061 1.386-.529 1.386-1.207 0-.618-.39-.936-1.09-1.1l-.296-.07v-1.2c.376.043.614.248.671.532h.658c-.047-.575-.54-1.024-1.329-1.073V8.5h-.375v.45c-.747.073-1.255.522-1.255 1.158 0 .562.378.92 1.007 1.066l.248.061v1.272c-.384-.058-.639-.27-.696-.563h-.668zm1.36-1.354c-.369-.085-.569-.26-.569-.522 0-.294.216-.514.572-.578v1.1zm.432.746c.449.104.655.272.655.569 0 .339-.257.571-.709.614v-1.195z"/><path d="M1 0a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h4.083q.088-.517.258-1H3a2 2 0 0 0-2-2V3a2 2 0 0 0 2-2h10a2 2 0 0 0 2 2v3.528c.38.34.717.728 1 1.154V1a1 1 0 0 0-1-1z"/><path d="M9.998 5.083 10 5a2 2 0 1 0-3.132 1.65 6 6 0 0 1 3.13-1.567"/></svg>`;
let BUY_OPEN=false,MONEY_AT=0,AUTO_BUY=null;
function spendable(){return Math.max(0,tableCash());}
// Whole steps of the minimum buy-in either side of the stack, as the server requires: down while at least
// the minimum stays on the table, up as far as spendable cash goes. A stack under the minimum can only top up.
function moneyBounds(p){
  const start=p.stack;
  const lo=start-Math.max(0,Math.floor((start-BUY)/BUY))*BUY;
  const hi=start+Math.floor(spendable()/BUY)*BUY;
  return {min:lo,max:hi,start};
}
function dragHint(p,v){return p.stack>=BUY&&v===moneyBounds(p).start;}
function moneyValue(p){
  const b=moneyBounds(p);
  let v=b.start+Math.round((Math.round(MONEY_AT)-b.start)/BUY)*BUY;
  if(v<b.min)v=b.min;if(v>b.max)v=b.max;return v;
}
const moneyWord=delta=>`${delta>0?'买入':'取出'} ${fmt(Math.abs(delta))} 筹码`;
function laterLine(delta){
  if(!delta)return '';
  return `<span class="rack-later">${moneyWord(delta)}将于本局结束后执行。</span>`;
}
// A finished buy-in or cash-out says so for 5 seconds, counting down.
const DONE_MS=5000;
let DONE=null,DONE_TICK=null;
const doneLeft=()=>Math.max(0,Math.ceil((DONE.until-Date.now())/1000));
function doneLine(){return DONE?`<span class="rack-later rack-done">${moneyWord(DONE.delta)}已执行。(${doneLeft()}s)</span>`:'';}
export function moneyDone(delta){
  sfx('notify-bank-complete');   // your own buy-in or cash-out has gone through (never a bot's rebuy)
  DONE={delta,until:Date.now()+DONE_MS};
  clearInterval(DONE_TICK);
  DONE_TICK=setInterval(()=>{
    if(!DONE||Date.now()>=DONE.until){DONE=null;clearInterval(DONE_TICK);renderHero();return;}
    for(const el of document.querySelectorAll('.rack-done'))el.textContent=`${moneyWord(DONE.delta)}已执行。(${doneLeft()}s)`;
  },1000);
  renderHero();
}
view.moneyDone=(p,delta)=>{if(p.uid===M.me)moneyDone(delta);};
function moneyNote(p){
  const wait=p.moneyWait||p.moneyReq;
  return wait?laterLine(wait):doneLine();
}
function moneyTicks(min,max,mark){
  const out=[];
  for(let v=min;v<=max;v+=BUY||1)out.push(v);
  if(!out.length||out[out.length-1]!==max)out.push(max);
  if(mark>min&&mark<max&&!out.includes(mark))out.push(mark);
  return out.sort((a,b)=>a-b);
}
export function toggleBuy(){
  const m=mySeat();if(m<0||!S)return;
  BUY_OPEN=!BUY_OPEN;
  // under the minimum, open on one buy-in
  if(BUY_OPEN){const p=S.seats[m],b=moneyBounds(p);MONEY_AT=p.stack<BUY?Math.min(b.max,p.stack+BUY):b.start;cancelAction();}
  renderHero();
}
export function confirmMoney(){
  const m=mySeat();if(m<0||!S)return;
  const p=S.seats[m],delta=moneyValue(p)-p.stack;
  if(!delta||delta%BUY)return;
  if(delta<0&&p.stack+delta<BUY)return;
  if(delta>0&&delta>spendable())return;
  BUY_OPEN=false;MONEY_AT=0;
  adjustMoney(delta);
}
export function railHTML(p,enabled){
  const avail=Z();for(const d of DV)avail[d]=Math.max(0,(p.chips[d]||0)-(enabled?PUSH[d]:0));
  return `<div class="rail${enabled?' live':''}"><div class="towers">${[1,5,10,25].map(d=>towerHTML(d,avail[d],enabled)).join('')}</div><button type="button" class="bank${BUY_OPEN?' on':''}" data-bank="1" aria-label="买入或取出" title="买入或取出">${BANK_ICON}</button></div>`;
}
function movePiles(delta){
  const n=Math.round(Math.abs(delta)/25);if(!n)return '';
  const sign=delta>0?'+':'-',tone=delta>0?'plus':'minus';
  return `<div class="bz-chips"><div class="pile"><div class="col">${chipEl(CCLS[25],18).repeat(Math.min(n,8))}</div><span class="n ${tone}">${sign}${n}</span></div></div>`;
}
function moneyRack(delta,clock,home){
  const hint=home?`<span class="rack-empty">拖动滑块以调整买入或取出金额。</span>`:'';
  return `<div class="betzone${delta||home?' has-move':''}" id="moneyRack">${delta?movePiles(delta):''}${hint}${lockedIn(S.seats[mySeat()])?laterLine(delta):''}${clock||''}</div>`;
}
function moneyHTML(p){
  const b=moneyBounds(p),v=moneyValue(p),delta=v-p.stack,buy=delta>=0;
  const ticks=moneyTicks(b.min,b.max,p.stack);
  return `<div class="raisebox moneybox ${delta>0?'buy':delta<0?'cash':''}">
    <div class="money-read"><b class="raise-num" id="moneyNum">${fmt(v)}</b><span class="money-avail" id="moneyAvail">可用余额 ${fmt(spendable())}</span></div>
    <div class="raise-scale" id="moneyScale">
      <div class="raise-line"><b class="fill"></b></div>
      <div class="raise-ticks">${ticks.map(n=>`<i data-v="${n}"></i>`).join('')}</div>
      <input id="moneyRange" type="range" min="${b.min}" max="${b.max}" step="${BUY}" value="${v}"${b.max<=b.min?' disabled':''} aria-label="买入或取出">
    </div>
    <div class="confirmbar">
      <button class="btn tidybtn${AUTO_TIDY?' on':''}" data-autotidy="1" aria-pressed="${AUTO_TIDY}">自动整理筹码</button>
      <button class="btn ${buy?'go-buy':'go-cash'}" id="moneyGo" data-money-go="1"${delta&&delta<=spendable()?'':' disabled'}>${delta<0?'取出':'买入'} ${fmt(Math.abs(delta))}</button>
    </div>
  </div>`;
}
function paintMoneyFill(p,v){
  const scale=$('moneyScale');if(!scale)return;
  layoutScaleTicks(scale);
  const fill=scale.querySelector('.fill');if(!fill)return;
  const origin=moneyBounds(p).start,z=scalePoint(scale,origin),x=scalePoint(scale,v);
  fill.style.left=Math.min(z,x)+'px';
  fill.style.width=Math.abs(x-z)+'px';
  fill.classList.toggle('plus',v>=origin);
  fill.classList.toggle('minus',v<origin);
}
function paintMoney(){
  const m=mySeat();if(m<0||!S)return;
  const p=S.seats[m],range=$('moneyRange');
  MONEY_AT=range?Number(range.value):MONEY_AT;
  const v=moneyValue(p);MONEY_AT=v;
  if(range&&String(range.value)!==String(v))range.value=String(v);
  const delta=v-p.stack,num=$('moneyNum'),avail=$('moneyAvail'),go=$('moneyGo'),box=document.querySelector('.moneybox');
  if(num)num.textContent=fmt(v);
  if(avail)avail.textContent=`可用余额 ${fmt(spendable())}`;
  if(go){go.disabled=!delta||delta>spendable();go.classList.toggle('go-buy',delta>=0);go.classList.toggle('go-cash',delta<0);go.textContent=`${delta<0?'取出':'买入'} ${fmt(Math.abs(delta))}`;}
  if(box){box.classList.toggle('buy',delta>0);box.classList.toggle('cash',delta<0);}
  paintMoneyFill(p,v);
  const rack=$('moneyRack');
  if(rack){const clock=rack.querySelector('.rack-clock');rack.outerHTML=moneyRack(delta,clock?clock.outerHTML:'',dragHint(p,v));}
}
document.addEventListener('input',e=>{if(e.target.id==='moneyRange')paintMoney();});
document.addEventListener('wheel',e=>{
  if(!e.target||e.target.id!=='moneyRange')return;
  e.preventDefault();
  const m=mySeat();if(m<0||!S)return;
  const p=S.seats[m],b=moneyBounds(p);
  MONEY_AT=Math.max(b.min,Math.min(b.max,moneyValue(p)+(e.deltaY>0?-BUY:BUY)));
  const range=$('moneyRange');if(range)range.value=String(MONEY_AT);
  paintMoney();
},{passive:false});
if(typeof window!=='undefined')window.addEventListener('resize',()=>{
  const scale=$('moneyScale');if(!scale)return;
  const m=mySeat();if(m<0||!S){layoutScaleTicks(scale);return;}
  paintMoneyFill(S.seats[m],moneyValue(S.seats[m]));
});
function preactsHTML(){
  return `<div class="preacts" role="group" aria-label="提前操作">${preOptions().map(o=>{const on=PRE&&PRE.hand===S.hand&&PRE.kind===o.k;return `<button data-pre="${o.k}" aria-pressed="${on}" class="${o.tone}${on?' on':''}">${o.en}<small>${o.zh}</small></button>`;}).join('')}</div>`;
}
export function renderHero(){
  const focus=document.activeElement&&document.activeElement.id==='betAmt';
  renderHeroInner();
  const inp=focus&&$('betAmt');if(inp){inp.focus();const n=inp.value.length;try{inp.setSelectionRange(n,n);}catch(e){}}
}
export function renderHeroInner(){
  const el=$('hero'),m=mySeat();
  if(m<0){
    el.classList.remove('win');$('meSeat').innerHTML='';
    const queued=MYDOC&&MYDOC.join;
    let ctl;
    const full=S.seats.length>=ONLINE_MAX;
    if(isKicked(M.me))ctl=`<div class="wait">你已被房主请出这个房间。</div>`;
    else if(queued)ctl=`<div class="wait">正在等待座位...</div><div class="main"><button class="btn fold small" data-a="leave">取消（退回这一手）</button></div>`;
    else if(!M.ready)ctl='';
    else ctl=`<div class="wait">${S.seats.length} 人在座${full?' · 已满 10 人，可以先排队':''}${handLive()?' · 牌局进行中，买入后这一手结束入座':''}</div><div class="main"><button class="btn next" data-a="join">${miniStackC(chipsOf25(BUY))} 买一手并入座 +${fmt(BUY)}</button></div>`;
    if(FLASH)ctl+=`<div class="flash">${esc(FLASH)}</div>`;
    el.innerHTML=`<div class="controls">${hostRequestsHTML()}${ctl}</div>`;
    return;
  }
  const p=S.seats[m];
  if(PUSH_TURN!==S.turn){setPUSH(Z());setPUSH_TURN(S.turn);}
  for(const d of DV)if(PUSH[d]>p.chips[d])PUSH[d]=p.chips[d];
  el.classList.toggle('win',!!p.win);
  const hole=myHoleCards();
  const cards=hole?hole.map((c,k)=>cardHTML(c,'big'+(p.win&&HOT.has(c)?' hot':''),dealCard(m,k,true))).join(''):cardHTML(undefined,'big')+cardHTML(undefined,'big');
  const mine=myTurn(),R=S.runout;
  const needBuy=p.stack===0&&!p.qBuy&&(S.street==='idle'||S.street==='done');
  if(S.mode!=='bots')BUY_OPEN=false;
  else if(!needBuy)AUTO_BUY=null;
  else if(AUTO_BUY!==SESSION){AUTO_BUY=SESSION;BUY_OPEN=true;MONEY_AT=moneyBounds(p).start;}
  const clock=S.deadline?cdSpan(S.deadline,'need cd'):'';
  const L=mine?actionLabels(p):null,waiting=mine&&!M.host&&SUBMITTED===S.turn,dis=waiting?' disabled':'';
  const later=BUY_OPEN?'':moneyNote(p),noted=later?' has-note':'';
  const zone=BUY_OPEN?moneyRack(moneyValue(p)-p.stack,clock?`<span class="rack-clock">${clock}</span>`:'',dragHint(p,moneyValue(p)))
    :needBuy?`<div class="betzone${noted}"><span class="rack-empty">买入筹码以开始。</span>${later}</div>`
    :mine?`<div class="betzone${L.pushed?' has':''}${noted}">
      ${L.pushed?`<div class="bz-chips">${[1,5,10,25].filter(d=>PUSH[d]>0).map(d=>`<button class="pull" data-pull="${d}" aria-label="撤回一枚 ${d}">${pilesC({1:0,5:0,10:0,25:0,[d]:PUSH[d]},{size:18,max:8})}</button>`).join('')}</div>`:`<span class="rack-empty">点击筹码以下注，再次点击以撤回。</span>`}
      ${later}${clock?`<span class="rack-clock">${clock}</span>`:''}
    </div>`
    :`<div class="betzone${noted}"><span class="rack-empty">未开始下注。</span>${later}</div>`;
  let ctl='';
  if(BUY_OPEN)ctl=moneyHTML(p);
  else if(mine){
    if(stillMyTurn(BET_MENU)&&L.canR){
      const sc=raiseScale(p);
      ctl+=`<div class="raisebox" style="--min:${sc.minPct}%;--val:${sc.pct}%">
        <b class="raise-num" id="raiseNum">${fmt(sc.value)}</b>
        <div class="raise-scale" id="raiseScale" style="--min:${sc.minPct}%;--val:${sc.pct}%">
          <div class="raise-line"><b class="fill"></b></div>
          <div class="raise-ticks">${sc.marks.map(m=>`<i data-v="${m.v}"></i>`).join('')}</div>
          <input id="raiseRange" type="range" min="0" max="${sc.max}" step="1" value="${sc.value}"${sc.max<=sc.min?' disabled':''} aria-label="加注金额">
          <div class="raise-marks">${sc.marks.filter(m=>m.label).map(m=>`<button type="button" data-raise-to="${m.v}" data-v="${m.v}">${m.k}</button>`).join('')}</div>
        </div>
        <div class="confirmbar">
          <button class="btn cancel" data-a="cancel">取消</button>
          <button class="btn ${sc.allIn?'allin':'raise'}" id="raiseGo" data-a="raise-go"${dis}>${sc.allIn?'All in':`Raise<small>${fmt(sc.value)}</small>`}</button>
        </div>
      </div>`;
    }else{
      ctl+=`<div class="main actions">
      <button class="btn call" data-a="call"${dis}>${L.callLbl}</button>
      <button class="btn raise" data-a="raise"${dis||!L.canR?' disabled':''}>Raise<small>加注</small></button>
      <button class="btn fold" data-a="fold"${dis}>Fold<small>弃牌</small></button>
      <button class="btn bet${L.betAllIn?' allin':''}" data-a="bet"${dis||!L.betOk?' disabled':''}>Bet<small>下注</small></button>
    </div>`;
    }
  }else{
    if(needBuy)ctl=preactsHTML();
    else if(S.street==='done'){
      const nx=S.nextAt?` ${cdSpan(S.nextAt)}`:'';
      const broke=p.stack===0&&!p.qBuy; // busted: the next hand waits for a buy-in, so offer only that
      // a closing table (23:55 Eastern) deals no more: only 退出牌桌
      if(S.mode==='bots')ctl=`<div class="main endbar"><button class="btn quit" data-exit-open="1">退出牌桌</button>${broke||S.closing?'':`<button class="btn next" data-a="next">继续游戏${nx}</button>`}</div>`;
    }else if(S.street!=='idle'){
      if(!p.inHand)ctl=`<div class="wait">请等待下一轮。</div>`;
      else if(p.folded)ctl=`<div class="wait">您已弃牌。</div>`;
      else if(p.allIn)ctl=`<div class="wait">您已 All in。</div>`;
      if(R&&R.stage==='vote'&&R.voters.includes(m)){
        const mv=R.votes[m]||(VOTED&&VOTED.hand===S.hand&&VOTED.turn===R.turn?VOTED.n:0);
        if(!mv)ctl+=`<div class="main"><button class="btn call" data-vote="1">跑一次</button><button class="btn raise" data-vote="2">跑两次</button></div>`;
      }else if(p.inHand&&!p.folded&&canAct(p)&&BETTING.includes(S.street)&&!(S.runout&&S.runout.stage))
        ctl+=preactsHTML();
    }
    if(S.mode==='online')ctl+=`<div class="main"><button class="btn fold small" data-a="leave"${p.leaving?' disabled':''}>离座</button></div>`;
  }
  if(FLASH)ctl+=`<div class="flash">${esc(FLASH)}</div>`;
  if(EMO_OPEN)ctl=`<div class="emopick" role="group" aria-label="表情">${EMOJIS.map(e=>`<button data-emo="${e}">${e}</button>`).join('')}</div>`+ctl;
  // your seat sits on the table, below the board; the panel underneath is chips and buttons
  const pushed=mine?csum(PUSH):0;
  $('meSeat').innerHTML=`<div class="me${p.folded?' folded':''}${p.win?' win':''}${mine?' turn':''}" data-i="${m}" style="--ph:-${Date.now()%1600}ms">
      ${p.bet>0?`<div class="herobet">${betHTML(p.bet,p.betChips,m)}</div>`:''}
      ${bubbleHTML(p,'hero-bubble')}
      <div class="hc">${cards}</div>
      <div class="plate">${mine?ringHTML():''}
        ${S.street!=='idle'&&p.inHand&&S.dealer===m?'<i class="dbtn">D</i>':''}${S.street!=='idle'&&p.inHand&&S.sbPos===m?'<i class="blind sb" title="小盲">S</i>':''}${S.street!=='idle'&&p.inHand&&S.bbPos===m?'<i class="blind bb" title="大盲">B</i>':''}<span class="who">${esc(myName())}</span>
        <b class="stk"><span class="num">${fmt(p.stack-pushed)}</span></b>${pushed?`<span class="pushed">→ ${fmt(pushed)}</span>`:''}
        <button class="emo-btn${EMO_OPEN?' on':''}" data-emo-open="1" aria-label="发表情" aria-expanded="${EMO_OPEN}">😀</button>
      </div>
    </div>`;
  el.innerHTML=`${zone}${railHTML(p,mine&&!BUY_OPEN)}<div class="controls">${hostRequestsHTML()}${ctl}</div>`;
  layoutRaiseMarks();if(BUY_OPEN)paintMoneyFill(p,moneyValue(p));
  after();
  setTimeout(autoTidy,0);
}
view.renderHero=renderHero;
