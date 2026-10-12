// Your station: cards, chip rail, bet zone, action buttons, cashier.
import {BET_MENU,CUSTOM_VAL,PENDING_ACTION,PRE,actionLabels,betPresets,confirmDetail,confirmLabel,confirmationPlan,pendingIsCurrent,preOptions,stillMyTurn} from '../actions.js';
import {describe} from '../cards.js';
import {BUY_CHIPS,CCLS,DV,Z,csum,tidied} from '../chips.js';
import {BETTING,BUY,ONLINE_MAX} from '../config.js';
import {heroResult} from '../fx.js';
import {PLAY_MODE,SHOW_HAND,dailyAllowance} from '../settings.js';
import {FLASH,M,MYDOC,PUSH,PUSH_TURN,S,SUBMITTED,VOTED,setPUSH,setPUSH_TURN,view} from '../state.js';
import {bookKey,canAct,handLive,isKicked,lockedIn,maxRaiseTo,mySeat,myTurn,names,netOf} from '../table.js';
import {EMOJIS,EMO_OPEN,avatarOf} from '../talk.js';
import {miniStack,miniStackC,pilesC} from './chips-view.js';
import {bubbleHTML,cardHTML,myHoleCards,seatName} from './table-view.js';
import {$,esc,fmt,sgn} from '../util.js';

export function hostRequestsHTML(){
  if(!M.host||!S||S.mode!=='online')return '';
  const asks=S.seats.filter(p=>p.askB>0),seatAsks=S.seats.filter(p=>p.askSeat);
  if(!asks.length&&!seatAsks.length)return '';
  const other=uid=>{const q=S.seats.find(x=>x.uid===uid);return q?esc(seatName(q)):'玩家';};
  return `<div class="requests">${asks.map(p=>`<div class="req"><span><b>${esc(seatName(p))}</b> 申请买一手 +200${p.askB>1?` ×${p.askB}`:''}</span>
    <button class="mini" data-deny="${esc(p.uid)}">拒绝</button><button class="mini ok" data-approve="${esc(p.uid)}">同意</button></div>`).join('')}${seatAsks.map(p=>`<div class="req"><span><b>${esc(seatName(p))}</b> 想和 <b>${other(p.askSeat)}</b> 换座位</span>
    <button class="mini" data-swapno="${esc(p.uid)}">拒绝</button><button class="mini ok" data-swapyes="${esc(p.uid)}">同意</button></div>`).join('')}</div>`;
}
export function cashierHTML(p){
  const pendB=p.qBuy,pendC=p.qCash;
  const locked=lockedIn(p);
  const canCash=p.stack-pendC*BUY+pendB*BUY>=BUY;
  // after a hand the result line already says you're out of chips
  let lbl=p.stack===0&&!pendB?(S.street==='done'?'':'筹码为 0，买一手才能上牌'):locked?'这一手结束后生效':'';
  if(pendB||pendC)lbl=`待生效：${pendB?`买 ${pendB} 手`:''}${pendB&&pendC?' · ':''}${pendC?`退 ${pendC} 手`:''}`;
  if(p.askB>0)lbl=(lbl?lbl+' · ':'')+`买 ${p.askB} 手，等房主同意`;
  const daily=S.mode==='bots'&&PLAY_MODE==='normal'?dailyAllowance():null;
  if(daily)lbl+=(lbl?' · ':'')+`今日剩余买入 ${fmt(daily.remaining)}`;
  return `<div class="cashier">${lbl?`<span class="lbl">${lbl}</span>`:''}
    <button class="cbtn${p.stack===0?' primary':''}" data-m="buy"${daily&&daily.remaining<BUY?' disabled':''}>${miniStack(BUY)}买一手 <b>+200</b></button>
    <button class="cbtn" data-m="cash"${canCash?'':' disabled'}>退一手 <b>−200</b></button></div>`;
}
export function towerHTML(d,count,enabled,pushed){
  const c=CCLS[d],shown=Math.min(count,12);
  return `<button class="tower ${c}" data-push="${d}"${enabled&&count>0?'':' disabled'} aria-label="${d} 面值，剩 ${count} 枚">
    <span class="tw">${'<i class="disc"></i>'.repeat(shown)}${count?'<span class="face"><i class="chip-d '+c+'"></i></span>':'<span class="emptyspot"></span>'}</span>
    <span class="cnt">×${count}</span></button>`;
}
export function railHTML(p,enabled){
  const avail=Z();for(const d of DV)avail[d]=p.chips[d]-(enabled?PUSH[d]:0);
  const t=tidied(p.chips),tidy=DV.every(d=>t[d]===p.chips[d]);
  return `<div class="rail${enabled?' live':''}"><div class="towers">${[1,5,10,25].map(d=>towerHTML(d,avail[d],enabled)).join('')}</div><button class="mini tidy" data-tidy="1"${tidy?' disabled':''} title="先凑 白10 红6 蓝6，其余换成绿25">整理</button></div>`;
}
export function renderHero(){
  const focus=document.activeElement&&document.activeElement.id==='betAmt';
  renderHeroInner();
  const inp=focus&&$('betAmt');if(inp){inp.focus();const n=inp.value.length;try{inp.setSelectionRange(n,n);}catch(e){}}
}
let VERDICT_HAND=-1;
export function renderHeroInner(){
  const el=$('hero'),m=mySeat();
  if(m<0){
    el.classList.remove('win');
    const queued=MYDOC&&MYDOC.join;
    let ctl;
    const full=S.seats.length>=ONLINE_MAX;
    if(isKicked(M.me))ctl=`<div class="wait">你已被房主请出这个房间。</div>`;
    else if(queued)ctl=`<div class="wait">已买一手，${handLive()?'这一手结束后入座。':full?'座位已满，有人离开后入座。':'马上入座…'}</div><div class="main"><button class="btn fold small" data-a="leave">取消（退回这一手）</button></div>`;
    else if(!M.keys)ctl=`<div class="wait">正在连接…</div>`;
    else ctl=`<div class="wait">${S.seats.length} 人在座${full?' · 已满 10 人，可以先排队':''}${handLive()?' · 牌局进行中，买入后这一手结束入座':''}</div><div class="main"><button class="btn next" data-a="join">${miniStackC(BUY_CHIPS())} 买一手并入座 +200</button></div>`;
    if(FLASH)ctl+=`<div class="flash">${esc(FLASH)}</div>`;
    el.innerHTML=`<div class="controls">${hostRequestsHTML()}${ctl}</div>`;
    return;
  }
  const p=S.seats[m];
  if(PUSH_TURN!==S.turn){setPUSH(Z());setPUSH_TURN(S.turn);}
  for(const d of DV)if(PUSH[d]>p.chips[d])PUSH[d]=p.chips[d];
  el.classList.toggle('win',!!p.win);
  const hole=myHoleCards();
  const cards=hole?hole.map(c=>cardHTML(c,'big')).join(''):cardHTML(undefined,'big')+cardHTML(undefined,'big');
  const pos=[];if(S.street!=='idle'&&p.inHand){if(S.dealer===m)pos.push('庄');if(S.sbPos===m)pos.push('小盲');if(S.bbPos===m)pos.push('大盲');}
  const handTxt=SHOW_HAND&&hole?describe(hole,S.board)+(S.board2&&S.board2.length>=3?' / '+describe(hole,S.board2):''):'';
  const nb=netOf(bookKey(p));
  const mine=myTurn(),R=S.runout;
  let ctl='',zone='';
  if(mine){
    const L=actionLabels(p),waiting=!M.host&&SUBMITTED===S.turn,dis=waiting?' disabled':'';
    zone=`<div class="betzone${L.pushed?' has':''}">
      <div class="bz-chips">${L.pushed?DV.filter(d=>PUSH[d]>0).map(d=>`<button class="pull" data-pull="${d}" aria-label="撤回一枚 ${d}">${pilesC({1:0,5:0,10:0,25:0,[d]:PUSH[d]},{size:18,max:8})}</button>`).join(''):'<span class="hint">点筹码下注</span>'}</div>
      <div class="bz-sum">${L.pushed?`<b>${fmt(L.pushed)}</b><button class="mini" data-clear="1">撤回</button>`:`<span class="need">${L.toCall?`跟注 ${fmt(L.toCall)}`:'可过牌'}</span>`}</div>
    </div>`;
    if(pendingIsCurrent()){
      const plan=confirmationPlan(),a=PENDING_ACTION,red=plan.type==='fold'||plan.allIn;
      if(a.custom)ctl+=`<label class="custom">${L.word} 到<input id="betAmt" type="number" inputmode="numeric" step="1" min="${L.minTo}" max="${maxRaiseTo(p)}" value="${esc(CUSTOM_VAL)}" autocomplete="off"><span>最少 ${fmt(L.minTo)} · 最多 ${fmt(maxRaiseTo(p))}</span></label>`;
      ctl+=`<div class="confirmbar">
        <button class="btn cancel" data-a="cancel">取消</button>
        <button class="btn go ${red?'red':'green'}" id="confirmGo" data-a="confirm"${plan.error?' disabled':''}>${plan.error&&!a.custom?'确认':confirmLabel(p,plan)}</button>
      </div><div class="confirmInfo${plan.error?' err':''}" id="confirmInfo">${esc(plan.error||confirmDetail(plan))}</div>`;
    }else if(stillMyTurn(BET_MENU)&&L.canR){
      ctl+=`<div class="presets betmenu">${betPresets(p).map(x=>`<button data-preset="${x.to||''}"${x.to?'':' disabled'}>${x.k}<small>${x.to?(x.to>=maxRaiseTo(p)?'All in':fmt(x.to)):'—'}</small></button>`).join('')}<button data-preset="custom">Custom<small>自定义</small></button></div>
        <div class="confirmbar one"><button class="btn cancel" data-a="cancel">取消</button></div>`;
    }else{
      ctl+=`<div class="main actions">
      <button class="btn fold" data-a="fold"${dis}>Fold</button>
      <button class="btn call" data-a="call"${dis}>${L.callLbl}</button>
      ${L.raise?`<button class="btn raise${L.raise.mode==='off'?' off':''}" data-a="raise" data-rmode="${L.raise.mode}"${dis||(L.raise.mode==='off'?' disabled':'')}>${L.raise.lbl}</button>`:`<button class="btn raise" disabled>${L.word}</button>`}
      <button class="btn allin" data-a="allin"${dis||(!L.canAllIn?' disabled':'')}>All in<small>${fmt(p.stack)}</small></button>
    </div>`;
    }
    if(S.deadline&&!M.host)ctl+=`<div class="wait">剩余 <span class="cd" data-until="${S.deadline}"></span>${waiting?' · 已提交，等房主确认…':''}</div>`;
  }else if(R&&R.stage==='vote'&&R.voters.includes(m)){
    const mv=R.votes[m]||(VOTED&&VOTED.hand===S.hand&&VOTED.turn===R.turn?VOTED.n:0);
    ctl=mv?`<div class="wait">你选了${mv===2?'跑两次':'跑一次'}，等其他人… <span class="cd" data-until="${R.deadline}"></span><br>所有人都选跑两次才会跑两次。</div>`
      :`<div class="wait"><b>全下！</b>跑几次？ <span class="cd" data-until="${R.deadline}"></span></div><div class="main"><button class="btn call" data-vote="1">跑一次</button><button class="btn raise" data-vote="2">跑两次</button></div>`;
  }else{
    if(S.street==='done'){
      const nx=S.nextAt?` <span class="cd" data-until="${S.nextAt}"></span>`:'';
      const w=`${S.msg.map(names).join('<br>')}`;
      const broke=p.stack===0&&!p.qBuy; // busted: the next hand waits for a buy-in, so offer only that
      if(S.mode==='bots')ctl=`<div class="wait">${w}</div>${broke?'':`<div class="main"><button class="btn next" data-a="next">下一手${nx}</button></div>`}${S.hand<=3?'<p class="seat-hint">点别人的座位：看资料、换座位</p>':''}`;
      else ctl=`<div class="wait">${w}<br>下一手${nx} 后开始</div>`;
    }else if(S.street==='idle'){
      ctl=`<div class="wait">${names(S.msg[0]||'等待开局')}</div>`;
    }else if(R&&R.stage==='deal'){
      ctl=`<div class="wait">全下 · ${R.times===2?'跑两次':'跑一次'}，发牌中…</div>`;
    }else if(!p.inHand){
      ctl=`<div class="wait">你这一手没上牌${p.stack===0?'（筹码为 0）':''}。买一手后下一手发牌给你。</div>`;
    }else{
      const a=S.actor>=0?`等 <b>${esc(seatName(S.seats[S.actor]))}</b> 行动…`:'发牌中…';
      ctl=`<div class="wait">${p.folded?'你已弃牌，看他们打完这手。':p.allIn?'你已全下，等结果。':(!hole&&!M.host?'正在解密你的底牌…':a)}</div>`;
      if(canAct(p)&&BETTING.includes(S.street)&&!(S.runout&&S.runout.stage))
        ctl+=`<div class="preacts" role="group" aria-label="提前操作">${preOptions(p).map(o=>{const on=PRE&&PRE.hand===S.hand&&PRE.kind===o.k;return `<button data-pre="${o.k}" aria-pressed="${on}" class="${on?'on':''}"><i></i>${o.lbl}</button>`;}).join('')}</div>`;
    }
    ctl+=cashierHTML(p);
    if(S.mode==='online')ctl+=`<button class="linkbtn" data-a="leave">${p.leaving?'将在这一手结束后离座':'离开座位'}</button>`;
  }
  if(FLASH)ctl+=`<div class="flash">${esc(FLASH)}</div>`;
  const res=heroResult(p);
  const firstVerdict=res&&VERDICT_HAND!==S.hand;if(res)VERDICT_HAND=S.hand;
  if(res)ctl=`<div class="verdict ${res.net>0?'up':res.net<0?'down':''}${firstVerdict?'':' still'}">${res.net>0?`🎉 这把赢了 +${fmt(res.net)}`:res.bust?`💸 输光了，买一手再战`:res.net<0?`😮‍💨 这把 −${fmt(-res.net)}`:'🤝 不输不赢'}</div>`+ctl;
  if(EMO_OPEN)ctl=`<div class="emopick" role="group" aria-label="表情">${EMOJIS.map(e=>`<button data-emo="${e}">${e}</button>`).join('')}</div>`+ctl;
  el.innerHTML=`${bubbleHTML(p,'hero-bubble')}<div class="me${p.folded?' folded':''}">
      <div class="hc">${cards}</div>
      <div class="info">
        <div class="row1"><span class="av big" aria-hidden="true">${avatarOf(p)}</span><span class="who">你</span><button class="emo-btn${EMO_OPEN?' on':''}" data-emo-open="1" aria-label="发表情" aria-expanded="${EMO_OPEN}">😀</button>${pos.map(t=>`<span class="tag">${t}</span>`).join('')}${handTxt?`<span class="hand">${esc(handTxt)}</span>`:''}</div>
        <div class="money"><b>${fmt(p.stack-(mine?csum(PUSH):0))}</b>${mine&&csum(PUSH)?`<span class="pushed">→ ${fmt(csum(PUSH))}</span>`:''}</div>
        <div class="sub">${p.bet>0?`本轮已下 ${fmt(p.bet)} · `:''}盈亏 <span class="${nb.net>0?'pos':nb.net<0?'neg':''}">${sgn(nb.net)}</span> <button class="linkbtn inline" data-view="records">账本</button></div>
      </div>
    </div>${zone}${mine||csum(p.chips)>0?railHTML(p,mine):''}<div class="controls">${hostRequestsHTML()}${ctl}</div>`;
}
view.renderHero=renderHero;
