// Bot strategy.
import {best7,rankOf,suitOf} from './cards.js';
import {BOT_STYLE} from './config.js';
import {BB} from './settings.js';
import {H,S} from './state.js';
import {N,canAct,canRaise,live,maxRaiseTo,minRaiseTo,potTotal} from './table.js';
import {botSay} from './talk.js';

// Estimates use only the acting bot's cards and publicly visible betting state.
export function startingStrength(hole){
  const hi=Math.max(...hole.map(rankOf)),lo=Math.min(...hole.map(rankOf));
  if(hi===lo)return Math.min(.99,.50+(hi-2)*.041);
  const suited=suitOf(hole[0])===suitOf(hole[1]),gap=hi-lo;
  return Math.max(.05,Math.min(.95,(hi+lo-4)/30+(suited?.07:0)+(gap===1?.045:0)-Math.max(0,gap-2)*.025));
}
export function rangeEquity(hole,board,opponents,iters){
  if(!opponents.length)return 1;
  const known=new Set(hole.concat(board)),deck=Array.from({length:52},(_,c)=>c).filter(c=>!known.has(c));
  let wins=0;
  for(let t=0;t<iters;t++){
    const pool=deck.slice(),hands=[];
    const draw=()=>pool.splice(Math.floor(Math.random()*pool.length),1)[0];
    for(const q of opponents){
      // Larger public bets imply a stronger range, with room for bluffs.
      const pressure=q.bet>BB?Math.min(1,q.bet/Math.max(BB,potTotal()-q.bet)):0;
      const tight=.25+pressure*.45+Math.min(.18,Math.max(0,(S.raises||0)-1)*.06);
      let h;
      for(let attempt=0;attempt<8;attempt++){
        h=[draw(),draw()];let strength=startingStrength(h);
        if(board.length>=3){
          const category=Math.floor(best7(h.concat(board))/Math.pow(16,5));
          strength=Math.max(strength*.65,Math.min(.98,.23+category*.18));
        }
        if(attempt===7||Math.random()<Math.max(.08,Math.min(1,1.1+strength-tight*2)))break;
        pool.push(...h);
      }
      hands.push(h);
    }
    const run=board.slice();while(run.length<5)run.push(draw());
    const mine=best7(hole.concat(run));let ties=1,lost=false;
    for(const h of hands){const score=best7(h.concat(run));if(score>mine){lost=true;break;}if(score===mine)ties++;}
    if(!lost)wins+=1/ties;
  }
  return wins/iters;
}
// what the core saw on its last decision, for the personality wrappers below
let CTX={};
function decideCore(p,i){
  const opponents=live().filter(q=>q!==p),opp=opponents.length,hole=H[i];
  const {loose,aggr,type}=BOT_STYLE[p.name]||{loose:.5,aggr:.5};
  const tag=type==='tag';
  const toCall=Math.min(Math.max(0,S.currentBet-p.bet),p.stack),pot=potTotal(),canR=canRaise(p);
  // Exclude side-pot money this stack cannot win from its call price.
  const eligible=S.seats.reduce((sum,q)=>sum+Math.min(q.total,p.total+toCall),0);
  const odds=toCall/(eligible+toCall||1);
  const active=S.seats.map((q,k)=>({q,k})).filter(({q})=>canAct(q));
  const order=active.sort((a,b)=>((a.k-S.dealer-1+N())%N())-((b.k-S.dealer-1+N())%N()));
  const position=order.length>1?order.findIndex(x=>x.k===i)/(order.length-1):1;
  const pre=S.board.length===0,strength=startingStrength(hole);
  CTX={pre,strength,eq:null,toCall,pot,canR};
  // Aggressive profiles accept races with medium-or-better starting hands.
  // Calls are capped by the engine at this bot's remaining stack.
  const humanShove=toCall>0&&opponents.some(q=>q.kind==='human'&&q.allIn&&q.bet===S.currentBet);
  if(pre&&humanShove&&aggr>=.70){
    const hi=Math.max(...hole.map(rankOf)),lo=Math.min(...hole.map(rankOf));
    const suited=suitOf(hole[0])===suitOf(hole[1]);
    const raceHand=(hi===lo&&hi>=6)||(hi===14&&lo>=9)
      ||(hi===13&&lo>=10)||(hi===12&&lo===11)
      ||(suited&&hi-lo===1&&lo>=8);
    if(raceHand)return {type:'call'};
  }
  const eq=rangeEquity(hole,S.board,opponents,Math.max(180,Math.floor(650/(opp+1))));
  CTX.eq=eq;
  if(!pre&&humanShove&&aggr>=.70&&eq>=.40)return {type:'call'};
  const raise=frac=>{
    let to=pre&&S.currentBet<=BB?BB*((tag?4:2.5)+(1-position)*.5)+S.seats.filter(q=>q!==p&&q.bet===BB).length*BB*(tag?1:.6)
      :S.currentBet+Math.max(S.minRaise,(pot+toCall)*frac);
    to=Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),Math.round(to)));
    // Commit the last few chips only when already close to an all-in.
    if(to>p.bet+p.stack*.90)to=maxRaiseTo(p);
    return {type:'raise',to};
  };
  // 奶龙 (土豪): never folds — checks when free, calls any bet; raises only now and then with a monster.
  if(type==='whale'){
    const r=Math.random(),big=pre?strength>.85:eq>.80;
    // ...but once all five cards are out he lets go without at least two pair or a real chance
    if(toCall&&S.board.length===5){
      const made=Math.floor(best7(hole.concat(S.board))/Math.pow(16,5));
      if(made<2&&eq<.5)return {type:'fold'};
    }
    if(canR&&big&&r<(toCall?.35:.5))return raise(.6);
    return {type:toCall?'call':'check'};
  }
  if(pre){
    const unopened=S.currentBet<=BB,depth=p.stack/BB;
    const openThreshold=tag?.62-position*.06:.64-position*.13-(loose-.5)*.08;
    const premium=strength>=(S.raises>=3?.91:S.raises>=2?.82:.74);
    // Joe opens big: 12.5BB with hands like AT, 25 or 37.5BB with QJ / TT and better (25 / 50 / 75 at 1/2)
    if(tag&&unopened&&canR&&strength>Math.min(.60,openThreshold)){
      const bbs=strength>=.66?(Math.random()<.5?25:37.5):12.5;
      const to=Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),Math.round(BB*bbs)));
      return {type:'raise',to:to>p.bet+p.stack*.9?maxRaiseTo(p):to};
    }
    // Joe doubles a raise before the flop whenever his hand is decent
    if(tag&&!unopened&&canR&&strength>.64&&eq>odds){
      const to=Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),S.currentBet*2));
      return {type:'raise',to:to>p.bet+p.stack*.9?maxRaiseTo(p):to};
    }
    if(canR&&((unopened&&strength>openThreshold)||(premium&&eq>odds+.10))){
      if(depth<=12&&strength>.77)return {type:'raise',to:maxRaiseTo(p)};
      return raise(tag?1:.65+aggr*.25);
    }
    if(!toCall)return {type:'check'};
    const realization=.74+position*.13+(suitOf(hole[0])===suitOf(hole[1])?.05:0);
    const margin=.025+(S.raises>=3?.06:0)-(loose-.5)*.025+(tag?.05:0);
    return eq*realization>odds+margin?{type:'call'}:{type:'fold'};
  }
  const cards=hole.concat(S.board),suits=[0,0,0,0];cards.forEach(c=>suits[suitOf(c)]++);
  const ranks=new Set(cards.map(rankOf));if(ranks.has(14))ranks.add(1);
  let straightDraw=false;for(let low=1;low<=10;low++){let count=0;for(let r=low;r<low+5;r++)if(ranks.has(r))count++;if(count===4)straightDraw=true;}
  const draw=S.board.length<5&&(suits.includes(4)||straightDraw);
  const value=eq>(opp===1?.62:opp===2?.49:.40);
  const r=Math.random(),size=tag?(eq>.82?1:.8):eq>.82?.85:.45+aggr*.22;
  if(!toCall){
    if(canR&&value&&r<.65+aggr*.3)return raise(size);
    if(!tag&&canR&&opp<=2&&draw&&eq>.22&&r<.12+aggr*.18)return raise(.55);
    if(!tag&&canR&&opp===1&&position>.7&&eq<.25&&r<.035+aggr*.035)return raise(.5);
    return {type:'check'};
  }
  const margin=(S.board.length===5?0:.025)+(opp>2?.025:0)-(loose-.5)*.025+(tag?.04:0);
  if(eq<odds+margin)return {type:'fold'};
  if(canR&&eq>(opp===1?.75:.62)&&r<.55+aggr*.35)return raise(size);
  if(!tag&&canR&&opp===1&&draw&&eq>.35&&toCall<pot*.4&&r<aggr*.12)return raise(.65);
  return {type:'call'};
}

// Kmetsch: after about three real hands (betting or calling with a strong holding) he switches to
// bluffing — bets or raises with anything — for two bluffs, then plays straight again.
const REAL_HANDS=3,BLUFFS=2;
function bluffTo(p,frac){
  const to=S.currentBet+Math.max(S.minRaise,(CTX.pot+CTX.toCall)*frac);
  return Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),Math.round(to)));
}
export function botDecide(p,i){
  const d=decideCore(p,i),{type}=BOT_STYLE[p.name]||{};
  if(type!=='bluffer')return d;
  if((p.real||0)>=REAL_HANDS&&CTX.canR){
    const r=Math.random(),weak=CTX.pre?CTX.strength<.6:(CTX.eq??0)<.5;
    const spot=CTX.pre?r<.5:!CTX.toCall?r<.8:r<.4;
    if(weak&&spot&&d.type!=='raise'){
      p.bl=(p.bl||0)+1;p.bluffs=(p.bluffs||0)+1;botSay(p,'bluff',.85);
      if(p.bl>=BLUFFS){p.real=0;p.bl=0;}
      return {type:'raise',to:bluffTo(p,CTX.pre?.8:.75)};
    }
  }
  const real=CTX.pre?CTX.strength>.74:(CTX.eq??0)>.6;
  if(real&&(d.type==='raise'||d.type==='call'))p.real=(p.real||0)+1;
  return d;
}

