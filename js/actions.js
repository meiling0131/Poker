// What the local player does: confirmations, bet presets, pre-actions, buy/cash/tidy.
import {DV,Z,csum,pickChips,tidied} from './chips.js';
import {BETTING,BUY} from './config.js';
import {castVote,doAction,maybeStart,proceed} from './engine.js';
import {commit} from './online.js';
import {serverMoney} from './net.js';
import {tableCash} from './ui/menu-view.js';
import {LOCAL_B,LOCAL_C,M,MYDOC,PUSH,S,SESSION,SUBMITTED,myRef,setFLASH,setLOCAL_B,setLOCAL_C,setPUSH,setSUBMITTED,setVOTED,view} from './state.js';
import {applyMoney,canRaise,lockedIn,maxRaiseTo,minRaiseTo,mySeat,myTurn,potTotal,settleAdjust} from './table.js';
import {$,fmt,store} from './util.js';
import {N_,sub,tr} from './i18n.js';

export let PENDING_ACTION=null,BET_MENU=null,CUSTOM_VAL='',RAISE_AT=0;
// 提前操作: chosen while someone else acts, played the moment the turn reaches you.
// cf = 过牌/弃牌, call = 只跟当前这注 (dropped if the bet changes), any = 跟任何注
export let PRE=null;
export function preOptions(){
  return [
    {k:'cf',en:'Check/Fold',zh:N_('过牌/弃牌'),tone:'light'},
    {k:'call',en:'Check',zh:N_('过牌'),tone:'light'},
    {k:'any',en:'Call Any',zh:N_('跟任何注'),tone:'any'},
  ];
}
export function setPre(kind){
  const m=mySeat();if(m<0||!S)return;
  if(PRE&&PRE.kind===kind&&PRE.hand===S.hand){PRE=null;view.renderHero();return;}
  PRE={kind,hand:S.hand,session:SESSION,bet:S.currentBet};view.renderHero();
}
export function runPre(){
  if(!PRE||!S)return;
  const m=mySeat(),p=m>=0?S.seats[m]:null;
  if(!p||PRE.session!==SESSION||PRE.hand!==S.hand||!p.inHand||p.folded||p.allIn||!BETTING.includes(S.street)){PRE=null;return;}
  if(PRE.kind==='call'&&S.currentBet!==PRE.bet){PRE=null;return;}
  if(!myTurn()||(!M.host&&SUBMITTED===S.turn))return;
  const toCall=Math.max(0,S.currentBet-p.bet),x=PRE;PRE=null;
  const type=x.kind==='cf'?(toCall?'fold':'check'):(toCall?'call':'check');
  const turn=S.turn;
  setTimeout(()=>{if(S&&S.turn===turn&&myTurn())act(type,0,null);},0);
}
// Fold and All in are confirmed in place: the four buttons turn into 取消 + 确认 …; everything else goes straight through.
export function cancelAction(){PENDING_ACTION=null;BET_MENU=null;}
export const stillMyTurn=x=>x&&S&&x.session===SESSION&&x.hand===S.hand&&x.turn===S.turn&&myTurn()&&(M.host||SUBMITTED!==S.turn);
export const pendingIsCurrent=()=>stillMyTurn(PENDING_ACTION);
export function confirmationPlan(){
  if(!pendingIsCurrent())return {error:tr('牌局已变化，请重新选择操作。')};
  const p=S.seats[mySeat()],a=PENDING_ACTION;
  const call=Math.min(p.stack,Math.max(0,S.currentBet-p.bet));
  let amount=0,to=0;
  if(a.type==='raise'){
    to=a.custom?Number(CUSTOM_VAL):a.to;
    if(!Number.isSafeInteger(to)||to<=0)return {error:tr('请输入有效的整数金额。')};
    if(!canRaise(p))return {error:tr('当前不能再加注。')};
    if(to>maxRaiseTo(p))return {error:tr('最多到 {n}（All in）。',{n:fmt(maxRaiseTo(p))})};
    if(to<minRaiseTo(p))return {error:tr('最少到 {n}。',{n:fmt(minRaiseTo(p))})};
    amount=to-p.bet;
  }else if(a.type==='call')amount=call;
  const selected=a.chips;
  const valid=selected&&DV.every(d=>Number.isInteger(selected[d])&&selected[d]>=0&&selected[d]<=p.chips[d]);
  const chips=amount&&valid&&csum(selected)>=amount?Object.assign({},selected):null;
  const change=chips?csum(chips)-amount:0;
  return {type:a.type,to,amount,chips,change,total:p.bet+amount,allIn:amount>0&&amount>=p.stack};
}
export function confirmLabel(p,plan){
  if(plan.type==='fold')return tr('确认 Fold');
  if(plan.allIn)return tr('确认 All in {n}',{n:fmt(plan.amount)});
  if(plan.type==='call')return tr('确认 Call {n}',{n:fmt(plan.amount)});
  return tr('确认 Raise {n}',{n:fmt(plan.to)});
}
export function confirmDetail(plan){
  if(plan.type==='fold')return tr('弃掉这一手牌');
  return tr('本次投入 {n} · 本轮合计 {t}',{n:fmt(plan.amount),t:fmt(plan.total)})+(plan.change?' · '+tr('找零 {c}',{c:fmt(plan.change)}):'');
}
export function requestAction(type,to=0,chips=null,custom=false){
  if(!myTurn()||(!M.host&&SUBMITTED===S.turn))return;
  if(type==='check'){cancelAction();act('check');return;}
  PENDING_ACTION={type,to,custom,session:SESSION,hand:S.hand,turn:S.turn,chips:chips?Object.assign({},chips):null};
  BET_MENU=null;
  if(custom)CUSTOM_VAL=String(to);
  view.renderHero();
  const inp=$('betAmt');if(inp&&custom){inp.focus();inp.select();}
}
export function openBetMenu(){
  if(!myTurn()||(!M.host&&SUBMITTED===S.turn))return;
  const p=S.seats[mySeat()];
  if(!canRaise(p))return;
  setPUSH(Z());PENDING_ACTION=null;
  RAISE_AT=minRaiseTo(p);
  BET_MENU={session:SESSION,hand:S.hand,turn:S.turn};view.renderHero();
}
// What Call or the raise slider meant to put in. A stack of big chips (a buy-in is all 25s) can't make 6 or 37
// exactly, so the chips picked come to more; Bet then pays the amount meant and the rest comes back as change,
// instead of betting every chip pushed. Chips you push or pull yourself drop it: then the chips are the bet.
let INTENT=null;
function intend(type,to){INTENT={type,to,session:SESSION,hand:S.hand,turn:S.turn,chips:Object.assign({},PUSH)};}
const intentNow=()=>INTENT&&stillMyTurn(INTENT)&&DV.every(d=>(PUSH[d]||0)===(INTENT.chips[d]||0))?INTENT:null;
// Call picks the chips you must put in. Check, with nothing to call, goes straight through.
export function selectCall(){
  if(!myTurn()||(!M.host&&SUBMITTED===S.turn))return;
  const p=S.seats[mySeat()],toCall=Math.max(0,S.currentBet-p.bet);
  cancelAction();
  if(toCall<=0){act('check');return;}
  setPUSH(pickChips(p.chips,Math.min(toCall,p.stack)));intend('call',0);
  view.renderHero();
}
// The slider runs to All in. Min. and All in are named beside it; the pot presets (1/3, 1/2, 2/3, Pot) are
// ticks on it and buttons under it (betPresets), so their names never crowd each other on a small pot.
export function raiseScale(p){
  const min=minRaiseTo(p),max=maxRaiseTo(p);
  let value=Math.round(RAISE_AT)||min;
  if(value<min)value=min;
  if(value>max)value=max;
  const at=v=>max>0?Math.min(100,Math.max(0,v/max*100)):0;
  const marks=[min,...betPresets(p).map(b=>b.v),max].map(v=>({v:Math.round(v),at:at(v)}));
  return {min,max,value,allIn:max>0&&value>=max,pct:at(value),minPct:at(min),marks};
}
// Where the slider thumb's center sits for a value, so ticks land on the same point.
export function scalePoint(scale,value){
  const input=scale.querySelector('input[type=range]');if(!input)return 0;
  const s=scale.getBoundingClientRect(),i=input.getBoundingClientRect();
  const thumb=18,min=+input.min||0,max=+input.max||0;
  const left=i.left-s.left,width=i.width;
  if(!(width>thumb)||!(max>min))return left+thumb/2;
  const ratio=Math.min(1,Math.max(0,(value-min)/(max-min)));
  return left+thumb/2+ratio*(width-thumb);
}
export function layoutScaleTicks(scale){
  if(!scale||!scale.clientWidth)return;
  scale.querySelectorAll('.raise-ticks i').forEach(el=>{el.style.left=scalePoint(scale,+el.dataset.v)+'px';});
  const fill=scale.querySelector('.raise-line .fill');
  const input=scale.querySelector('input[type=range]');
  if(fill&&input)fill.style.width=scalePoint(scale,+input.value)+'px';
}
// The raise slider's ticks and filled bar (Min. and All in are named beside it, the presets under it).
export function layoutRaiseMarks(){layoutScaleTicks($('raiseScale'));}
function paintRaise(){
  const p=S&&mySeat()>=0?S.seats[mySeat()]:null;if(!p)return;
  const sc=raiseScale(p);RAISE_AT=sc.value;
  const num=$('raiseNum'),go=$('raiseGo'),scale=$('raiseScale'),range=$('raiseRange');
  // the number is the Custom box: while you type in it, it keeps what you typed
  if(num&&document.activeElement!==num)num.value=String(sc.value);
  if(scale)scale.style.setProperty('--val',sc.pct+'%');
  if(range&&String(range.value)!==String(sc.value))range.value=String(sc.value);
  if(go){go.classList.toggle('allin',sc.allIn);go.classList.toggle('raise',!sc.allIn);go.innerHTML=sc.allIn?'All in':`Raise<small>${fmt(sc.value)}</small>`;}
  layoutRaiseMarks();
}
export function setRaiseAt(n){RAISE_AT=n;paintRaise();}
export function commitRaise(){
  if(!stillMyTurn(BET_MENU))return;
  const p=S.seats[mySeat()],sc=raiseScale(p);
  const chips=pickChips(p.chips,Math.max(0,sc.value-p.bet));
  cancelAction();setPUSH(chips);intend('raise',sc.value);view.renderHero();
}
export function placeBet(){
  if(!myTurn()||(!M.host&&SUBMITTED===S.turn))return;
  const p=S.seats[mySeat()],L=actionLabels(p);
  if(!L.betOk)return;
  const chips=Object.assign({},PUSH);
  // putting the whole stack in asks once more, like Fold
  if(L.betAllIn){requestAction(L.betType,L.betType==='raise'?L.to:0,chips);return;}
  cancelAction();act(L.betType,L.betType==='raise'?L.to:0,chips);
}
// 常用下注：raise-to totals, null when below the minimum; anything past the stack becomes All in (v: where it falls)
export function betPresets(p){
  const toCall=Math.max(0,S.currentBet-p.bet),pot=potTotal(),minTo=minRaiseTo(p),maxTo=maxRaiseTo(p);
  // raise to: the current bet, plus that share of the pot once you have called
  return [['1/3 Pot',1/3],['1/2 Pot',1/2],['2/3 Pot',2/3],['Pot',1]]
    .map(([k,f])=>{const t=S.currentBet+Math.round((pot+toCall)*f);return {k,v:t,to:t<minTo?null:Math.min(t,maxTo)};});
}
export function confirmAction(){
  const plan=confirmationPlan();
  if(plan.error){view.renderHero();return;}
  cancelAction(); // Clear before dispatch so double clicks / held Enter cannot repeat.
  act(plan.type,plan.to,plan.chips);
}
document.addEventListener('input',e=>{
  if(e.target.id==='raiseRange'){RAISE_AT=Number(e.target.value);paintRaise();return;}
  if(e.target.id==='raiseNum'){const v=Math.round(Number(e.target.value));if(v>0){RAISE_AT=v;paintRaise();}return;}
  if(e.target.id!=='betAmt')return;
  CUSTOM_VAL=e.target.value;
  const plan=confirmationPlan(),go=$('confirmGo'),info=$('confirmInfo');
  if(go){go.disabled=!!plan.error;if(!plan.error){go.textContent=confirmLabel(S.seats[mySeat()],plan);go.classList.toggle('red',plan.allIn);go.classList.toggle('green',!plan.allIn);}}
  if(info){info.textContent=plan.error||confirmDetail(plan);info.classList.toggle('err',!!plan.error);}
});
if(typeof window!=='undefined')window.addEventListener('resize',()=>layoutRaiseMarks());
document.addEventListener('wheel',e=>{
  if(!e.target||e.target.id!=='raiseRange')return;
  e.preventDefault();
  const step=e.shiftKey?25:1;
  setRaiseAt(RAISE_AT+(e.deltaY>0?-step:step));
},{passive:false});
document.addEventListener('keydown',e=>{
  if(!pendingIsCurrent()&&!stillMyTurn(BET_MENU))return;
  if(e.key==='Escape'){e.preventDefault();cancelAction();view.renderHero();}
  else if(e.key==='Enter'&&!e.isComposing&&pendingIsCurrent()){e.preventDefault();if(!e.repeat)confirmAction();}
  else if(e.key==='Enter'&&!e.isComposing&&e.target.id==='raiseNum'){e.preventDefault();if(!e.repeat)commitRaise();}
});
// leaving the Custom box shows the amount the slider settled on (within Min. and All in)
document.addEventListener('focusout',e=>{if(e.target.id==='raiseNum')e.target.value=String(RAISE_AT||e.target.value);});
export async function act(type,to,chips){
  if(!myTurn())return;
  to=to||0;chips=chips||null;
  if(M.host){setPUSH(Z());doAction(S.seats[mySeat()],type,to,chips);proceed();return;}
  if(SUBMITTED===S.turn)return;
  const turn=S.turn,hand=S.hand;
  setSUBMITTED(turn);setFLASH('');
  preview(type,to,chips);
  // sent before anything is redrawn: the seat doc's own echo (net.js) redraws the page as soon as it has gone
  try{await myRef.update({act:{hand,turn,type,to,chips}});setPUSH(Z());}
  catch(e){setSUBMITTED(-1);setFLASH(tr('提交失败，请再点一次。'));view.render();}
}
// The table is the server's, a network round trip away: your own action is shown at once on this page's copy,
// and the server's copy replaces it a moment later (the same, plus whoever acts next). Buy-ins and cash-outs
// waiting for the hand to end are left to the server, and this copy may come without the log.
function preview(type,to,chips){
  const p=S.seats[mySeat()],money={moneyWait:p.moneyWait,qBuy:p.qBuy,qCash:p.qCash},log=S.log;
  Object.assign(p,{moneyWait:0,qBuy:0,qCash:0});if(!log)S.log=[];
  try{doAction(p,type,to,chips);S.actor=-1;S.deadline=0;}catch(e){/* the server's answer shows it anyway */}
  Object.assign(p,money);if(!log)delete S.log;
}
export async function vote(n){
  const m=mySeat(),R=S&&S.runout;if(m<0||!R||R.stage!=='vote'||!R.voters.includes(m)||R.votes[m])return;
  if(M.host){castVote(m,n);return;}
  setVOTED({hand:S.hand,turn:R.turn,n});
  try{await myRef.update({act:{type:'rit',n,hand:S.hand,turn:R.turn}});}catch(e){setVOTED(null);setFLASH(tr('提交失败，请再点一次。'));view.render();}
}
export async function money(kind){
  const m=mySeat();if(m<0)return;
  const p=S.seats[m];
  if(kind==='buy'&&BUY>tableCash())return;
  if(kind==='cash'&&p.stack-p.qCash*BUY+p.qBuy*BUY<BUY){setFLASH(tr('筹码不足 {n}，不能退一手。',{n:BUY}));view.render();return;}
  setFLASH('');
  if(S.mode==='bots'&&!M.host){
    const d=MYDOC||{};
    try{
      if(kind==='buy'){setLOCAL_B(Math.max(LOCAL_B,Number(d.buyN)||0)+1);await myRef.update({name:M.nick,join:true,buyN:LOCAL_B});}
      else{setLOCAL_C(Math.max(LOCAL_C,Number(d.cashN)||0)+1);await myRef.update({name:M.nick,join:true,cashN:LOCAL_C});}
    }catch(e){setFLASH(tr('提交失败，请再试一次。'));}
    view.render();return;
  }
  if(S.mode==='bots'){
    if(kind==='buy')p.qBuy++;else p.qCash++;
    // after a hand the table waits for 继续游戏, even when this buy-in follows going broke
    applyMoney(p);commit();
    maybeStart();return;
  }
  const d=MYDOC||{};
  try{
    if(kind==='buy'){setLOCAL_B(Math.max(LOCAL_B,Number(d.buyN)||0)+1);await myRef.update({buyN:LOCAL_B});}
    else{setLOCAL_C(Math.max(LOCAL_C,Number(d.cashN)||0)+1);await myRef.update({cashN:LOCAL_C});}
  }catch(e){setFLASH(tr('提交失败，请再试一次。'));}
  view.render();
}
export async function buyAmount(amt){
  const m=mySeat();if(m<0||!S||S.mode!=='bots')return;
  const units=amt/BUY;
  if(!Number.isInteger(units)||units<1)return;
  const p=S.seats[m];
  if(amt>tableCash())return;
  setFLASH('');
  if(!M.host){
    const n=Math.max(LOCAL_B,Number((MYDOC||{}).buyN)||0)+units;
    setLOCAL_B(n);
    try{await myRef.update({name:M.nick,join:true,buyN:n});}
    catch(e){setFLASH(tr('提交失败，请再试一次。'));}
    view.render();return;
  }
  p.qBuy+=units;applyMoney(p);commit();maybeStart();
}
export async function cashAmount(amt){
  const m=mySeat();if(m<0||!S||S.mode!=='bots')return;
  const units=amt/BUY;
  if(!Number.isInteger(units)||units<1)return;
  const p=S.seats[m];
  if(units>Math.floor(p.stack/BUY))return;
  setFLASH('');
  if(!M.host){
    const n=Math.max(LOCAL_C,Number((MYDOC||{}).cashN)||0)+units;
    setLOCAL_C(n);
    try{await myRef.update({name:M.nick,join:true,cashN:n});}
    catch(e){setFLASH(tr('提交失败，请再试一次。'));}
    view.render();return;
  }
  p.qCash+=units;applyMoney(p);commit();
}
// Buy or cash an exact amount. During a live hand it waits until the hand ends.
export async function adjustMoney(delta){
  delta=Math.round(delta);if(!delta||delta%BUY)return;
  const m=mySeat();if(m<0||!S||S.mode!=='bots')return;
  const p=S.seats[m];
  if(delta<0&&p.stack+delta<BUY)return;
  if(delta>0&&delta>tableCash())return;
  setFLASH('');
  if(!M.host){serverMoney(delta);view.render();return;}
  if(lockedIn(p)){p.moneyWait=(p.moneyWait||0)+delta;commit();return;}
  if(settleAdjust(p,delta)&&view.moneyDone)view.moneyDone(p,delta);
  commit();if(delta>0)maybeStart();
}
export let LOCAL_T=0;
// 整理: change the stack into the usual mix (chips.js tidyTarget), at any time, also in the middle of a hand
export async function tidy(){
  const m=mySeat();if(m<0||!S)return;
  const p=S.seats[m];setPUSH(Z());setFLASH('');cancelAction();
  const t=tidied(p.chips);
  if(DV.every(d=>t[d]===p.chips[d])){view.renderHero();return;}
  if(M.host){p.chips=t;commit();return;}
  try{LOCAL_T=Math.max(LOCAL_T,Number((MYDOC||{}).tidyN)||0)+1;await myRef.update({tidyN:LOCAL_T});}
  catch(e){setFLASH(tr('整理失败，请再试一次。'));}
  view.render();
}
export let AUTO_TIDY=store.get('poker.autoTidy')==='1';
let TIDY_KEY='';
export function toggleAutoTidy(){AUTO_TIDY=!AUTO_TIDY;store.set('poker.autoTidy',AUTO_TIDY?'1':'0');TIDY_KEY='';view.renderHero();}
// runs after each hero render; skipped while chips are picked or an action is being confirmed
export function autoTidy(){
  if(!AUTO_TIDY||!S)return;
  const m=mySeat();if(m<0)return;
  const p=S.seats[m];
  if(!p.stack||csum(PUSH)||PENDING_ACTION||BET_MENU)return;
  const t=tidied(p.chips);if(DV.every(d=>t[d]===p.chips[d])){TIDY_KEY='';return;}
  const key=`${SESSION}:${S.hand}:${DV.map(d=>p.chips[d]).join(',')}`;if(key===TIDY_KEY)return;
  TIDY_KEY=key;
  if(M.host){p.chips=t;commit();return;}
  LOCAL_T=Math.max(LOCAL_T,Number((MYDOC||{}).tidyN)||0)+1;
  myRef.update({tidyN:LOCAL_T}).catch(()=>{TIDY_KEY='';});
}
export function actionLabels(p){
  const toCall=Math.max(0,S.currentBet-p.bet),pushed=csum(PUSH),canR=canRaise(p),minTo=minRaiseTo(p);
  const word='Raise',to=p.bet+pushed,allIn=pushed>0&&pushed>=p.stack;
  const n=Math.min(toCall,p.stack);
  const r={toCall,pushed,canR,minTo,word,to,allIn};
  r.callLbl=toCall===0?'Check'+sub('过牌'):`Call ${fmt(n)}${sub(`跟注 ${fmt(n)}`)}`;
  r.canAllIn=p.stack>0&&(p.stack<=toCall||canR);
  r.callChange=pushed>toCall&&toCall>0&&!(to>=minTo||allIn)?pushed-toCall:0;
  // Bet sends the selected chips. Anything short of a call, or a raise short of the minimum, stays disabled.
  let betOk=false,betType='call';
  if(toCall>0&&(pushed===toCall||(allIn&&p.stack<=toCall))){betOk=true;betType='call';}
  else if(canR&&pushed>toCall&&(to>=minTo||allIn)){betOk=true;betType='raise';}
  else if(canR&&toCall===0&&pushed>0&&(to>=minTo||allIn)){betOk=true;betType='raise';}
  r.betOk=betOk;r.betType=betType;r.betAllIn=betOk&&allIn;r.betAmt=pushed;r.change=0;
  // Call or the slider picked more chips than it meant: Bet pays what was meant (betAmt), the rest is change
  const it=intentNow(),amt=it?(it.type==='call'?Math.min(toCall,p.stack):Math.min(it.to,p.bet+p.stack)-p.bet):0;
  if(it&&amt>0&&pushed>=amt&&(it.type==='call'?toCall>0:canR))
    Object.assign(r,{betOk:true,betType:it.type,to:p.bet+amt,betAmt:amt,change:pushed-amt,betAllIn:amt>=p.stack});
  return r;
}
export function commitAllIn(p){
  const L=actionLabels(p);
  if(!L.canAllIn)return;
  const chips=Object.assign(Z(),p.chips);
  if(p.stack<=L.toCall)requestAction('call',0,chips);
  else requestAction('raise',p.bet+p.stack,chips);
}
export function setPRE(v){PRE=v;}
