// What the local player does: confirmations, bet presets, pre-actions, buy/cash/tidy.
import {DV,Z,csum,tidyChips} from './chips.js';
import {BETTING,BUY} from './config.js';
import {castVote,doAction,maybeStart,proceed} from './engine.js';
import {commit} from './online.js';
import {BB,PLAY_MODE,reserveDailyBuy} from './settings.js';
import {LOCAL_B,LOCAL_C,M,MYDOC,PUSH,S,SESSION,SUBMITTED,myRef,setFLASH,setLOCAL_B,setLOCAL_C,setPUSH,setSUBMITTED,setVOTED} from './state.js';
import {applyMoney,canRaise,maxRaiseTo,minRaiseTo,mySeat,myTurn,potTotal} from './table.js';
import {renderHero} from './ui/hero-view.js';
import {render} from './ui/render.js';
import {$,fmt} from './util.js';

export let PENDING_ACTION=null,BET_MENU=null,CUSTOM_VAL='';
// 提前操作: chosen while someone else acts, played the moment the turn reaches you.
// cf = 过牌/弃牌, call = 只跟当前这注 (dropped if the bet changes), any = 跟任何注
export let PRE=null;
export function preOptions(p){
  const toCall=Math.min(p.stack,Math.max(0,S.currentBet-p.bet));
  return [{k:'cf',lbl:toCall?'弃牌':'过牌/弃牌'},{k:'call',lbl:toCall?`跟注 ${fmt(toCall)}`:'过牌'},{k:'any',lbl:'跟任何注'}];
}
export function setPre(kind){
  const m=mySeat();if(m<0||!S)return;
  if(PRE&&PRE.kind===kind&&PRE.hand===S.hand){PRE=null;renderHero();return;}
  PRE={kind,hand:S.hand,session:SESSION,bet:S.currentBet};renderHero();
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
// Actions are confirmed in place: the four buttons turn into 取消 + 确认 …; Check goes straight through.
export function cancelAction(){PENDING_ACTION=null;BET_MENU=null;}
export const stillMyTurn=x=>x&&S&&x.session===SESSION&&x.hand===S.hand&&x.turn===S.turn&&myTurn()&&(M.host||SUBMITTED!==S.turn);
export const pendingIsCurrent=()=>stillMyTurn(PENDING_ACTION);
export function confirmationPlan(){
  if(!pendingIsCurrent())return {error:'牌局已变化，请重新选择操作。'};
  const p=S.seats[mySeat()],a=PENDING_ACTION;
  const call=Math.min(p.stack,Math.max(0,S.currentBet-p.bet));
  let amount=0,to=0;
  if(a.type==='raise'){
    to=a.custom?Number(CUSTOM_VAL):a.to;
    if(!Number.isSafeInteger(to)||to<=0)return {error:'请输入有效的整数金额。'};
    if(!canRaise(p))return {error:'当前不能再加注。'};
    if(to>maxRaiseTo(p))return {error:`最多到 ${fmt(maxRaiseTo(p))}（All in）。`};
    if(to<minRaiseTo(p))return {error:`最少到 ${fmt(minRaiseTo(p))}。`};
    amount=to-p.bet;
  }else if(a.type==='call')amount=call;
  const selected=a.chips;
  const valid=selected&&DV.every(d=>Number.isInteger(selected[d])&&selected[d]>=0&&selected[d]<=p.chips[d]);
  const chips=amount&&valid&&csum(selected)>=amount?Object.assign({},selected):null;
  const change=chips?csum(chips)-amount:0;
  return {type:a.type,to,amount,chips,change,total:p.bet+amount,allIn:amount>0&&amount>=p.stack};
}
export function confirmLabel(p,plan){
  if(plan.type==='fold')return '确认 Fold';
  if(plan.allIn)return `确认 All in ${fmt(plan.amount)}`;
  if(plan.type==='call')return `确认 Call ${fmt(plan.amount)}`;
  return `确认 ${actionLabels(p).word} ${fmt(plan.to)}`;
}
export function confirmDetail(plan){
  if(plan.type==='fold')return '弃掉这一手牌';
  return `本次投入 ${fmt(plan.amount)} · 本轮合计 ${fmt(plan.total)}${plan.change?` · 找零 ${fmt(plan.change)}`:''}`;
}
export function requestAction(type,to=0,chips=null,custom=false){
  if(!myTurn()||(!M.host&&SUBMITTED===S.turn))return;
  if(type==='check'){cancelAction();act('check');return;}
  PENDING_ACTION={type,to,custom,session:SESSION,hand:S.hand,turn:S.turn,chips:chips?Object.assign({},chips):null};
  BET_MENU=null;
  if(custom)CUSTOM_VAL=String(to);
  renderHero();
  const inp=$('betAmt');if(inp&&custom){inp.focus();inp.select();}
}
export function openBetMenu(){
  if(!myTurn()||(!M.host&&SUBMITTED===S.turn))return;
  PENDING_ACTION=null;BET_MENU={session:SESSION,hand:S.hand,turn:S.turn};renderHero();
}
// 常用下注：raise-to totals, null when below the minimum; anything past the stack becomes All in
export function betPresets(p){
  const toCall=Math.max(0,S.currentBet-p.bet),pot=potTotal(),minTo=minRaiseTo(p),maxTo=maxRaiseTo(p);
  return [['1BB',BB],['3BB',3*BB],['1/2 Pot',S.currentBet+Math.round((pot+toCall)/2)],['Pot',S.currentBet+pot+toCall]]
    .map(([k,t])=>({k,to:t<minTo?null:Math.min(t,maxTo)}));
}
export function confirmAction(){
  const plan=confirmationPlan();
  if(plan.error){renderHero();return;}
  cancelAction(); // Clear before dispatch so double clicks / held Enter cannot repeat.
  act(plan.type,plan.to,plan.chips);
}
document.addEventListener('input',e=>{
  if(e.target.id!=='betAmt')return;
  CUSTOM_VAL=e.target.value;
  const plan=confirmationPlan(),go=$('confirmGo'),info=$('confirmInfo');
  if(go){go.disabled=!!plan.error;if(!plan.error){go.textContent=confirmLabel(S.seats[mySeat()],plan);go.classList.toggle('red',plan.allIn);go.classList.toggle('green',!plan.allIn);}}
  if(info){info.textContent=plan.error||confirmDetail(plan);info.classList.toggle('err',!!plan.error);}
});
document.addEventListener('keydown',e=>{
  if(!pendingIsCurrent()&&!stillMyTurn(BET_MENU))return;
  if(e.key==='Escape'){e.preventDefault();cancelAction();renderHero();}
  else if(e.key==='Enter'&&!e.isComposing&&pendingIsCurrent()){e.preventDefault();if(!e.repeat)confirmAction();}
});
export async function act(type,to,chips){
  if(!myTurn())return;
  to=to||0;chips=chips||null;
  if(M.host){setPUSH(Z());doAction(S.seats[mySeat()],type,to,chips);proceed();return;}
  if(SUBMITTED===S.turn)return;
  setSUBMITTED(S.turn);setFLASH('');render();
  try{await myRef.update({act:{hand:S.hand,turn:S.turn,type,to,chips}});setPUSH(Z());}
  catch(e){setSUBMITTED(-1);setFLASH('提交失败，请再点一次。');render();}
}
export async function vote(n){
  const m=mySeat(),R=S&&S.runout;if(m<0||!R||R.stage!=='vote'||!R.voters.includes(m)||R.votes[m])return;
  if(M.host){castVote(m,n);return;}
  setVOTED({hand:S.hand,turn:R.turn,n});render();
  try{await myRef.update({act:{type:'rit',n,hand:S.hand,turn:R.turn}});}catch(e){setVOTED(null);setFLASH('提交失败，请再点一次。');render();}
}
export async function money(kind){
  const m=mySeat();if(m<0)return;
  const p=S.seats[m];
  if(kind==='cash'&&p.stack-p.qCash*BUY+p.qBuy*BUY<BUY){setFLASH('筹码不足 200，不能退一手。');render();return;}
  setFLASH('');
  if(S.mode==='bots'){
    if(kind==='buy'&&PLAY_MODE==='normal'){
      const session=SESSION,table=S;
      const ok=await reserveDailyBuy(()=>SESSION===session&&S===table&&PLAY_MODE==='normal');
      if(!ok){if(SESSION===session&&S===table)render();return;}
    }
    if(kind==='buy')p.qBuy++;else p.qCash++;
    applyMoney(p);commit();maybeStart();return;
  }
  const d=MYDOC||{};
  try{
    if(kind==='buy'){setLOCAL_B(Math.max(LOCAL_B,Number(d.buyN)||0)+1);await myRef.update({buyN:LOCAL_B});}
    else{setLOCAL_C(Math.max(LOCAL_C,Number(d.cashN)||0)+1);await myRef.update({cashN:LOCAL_C});}
  }catch(e){setFLASH('提交失败，请再试一次。');}
  render();
}
export let LOCAL_T=0;
export async function tidy(){
  const m=mySeat();if(m<0)return;
  const p=S.seats[m];setPUSH(Z());setFLASH('');cancelAction();
  if(M.host){if(tidyChips(p))commit();else renderHero();return;}
  try{LOCAL_T=Math.max(LOCAL_T,Number((MYDOC||{}).tidyN)||0)+1;await myRef.update({tidyN:LOCAL_T});}
  catch(e){setFLASH('整理失败，请再试一次。');}
  render();
}
export function actionLabels(p){
  const toCall=Math.max(0,S.currentBet-p.bet),pushed=csum(PUSH),canR=canRaise(p),minTo=minRaiseTo(p);
  const pre=S.street==='preflop',level=Math.max(pre?2:1,(S.raises||0)+1);
  const word=pre?(level===2?'Open-Raise':`${level}-bet`):(S.currentBet===0?'Bet':level===2?'Raise':`${level}-bet`);
  const to=p.bet+pushed,allIn=pushed>0&&pushed>=p.stack;
  const r={toCall,pushed,canR,minTo,word,to,allIn};
  r.callLbl=toCall===0?'Check':`Call<small>${fmt(Math.min(toCall,p.stack))}${toCall>=p.stack?' · All in':''}</small>`;
  r.canAllIn=p.stack>0&&(p.stack<=toCall||canR);
  r.callChange=pushed>toCall&&toCall>0&&!(to>=minTo||allIn)?pushed-toCall:0;
  if(r.callChange)r.callLbl=`Call ${fmt(toCall)}<small>找零 ${fmt(r.callChange)}</small>`;
  if(!canR){r.raise=null;}
  else if(pushed===0){r.raise={lbl:`${word}<small>自定义</small>`,mode:'fill'};}
  else if(allIn){r.raise={lbl:`${word}<small>All in · ${fmt(p.bet+p.stack)}</small>`,mode:'go'};}
  else if(to>=minTo){r.raise={lbl:word==='Bet'?`Bet<small>${fmt(to)}</small>`:`${word}<small>到 ${fmt(to)}</small>`,mode:'go'};}
  else{r.raise={lbl:`${word}<small>还差 ${fmt(minTo-to)}</small>`,mode:'off'};}
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
