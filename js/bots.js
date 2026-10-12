// Bot strategy.
import {best7,rankOf,suitOf} from './cards.js';
import {BOT_STYLE} from './config.js';
import {BB} from './settings.js';
import {H,S} from './state.js';
import {N,canAct,canRaise,live,maxRaiseTo,minRaiseTo,potTotal} from './table.js';

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
export function botDecide(p,i){
  const opponents=live().filter(q=>q!==p),opp=opponents.length,hole=H[i];
  const {loose,aggr}=BOT_STYLE[p.name]||{loose:.5,aggr:.5};
  const toCall=Math.min(Math.max(0,S.currentBet-p.bet),p.stack),pot=potTotal(),canR=canRaise(p);
  // Exclude side-pot money this stack cannot win from its call price.
  const eligible=S.seats.reduce((sum,q)=>sum+Math.min(q.total,p.total+toCall),0);
  const odds=toCall/(eligible+toCall||1);
  const active=S.seats.map((q,k)=>({q,k})).filter(({q})=>canAct(q));
  const order=active.sort((a,b)=>((a.k-S.dealer-1+N())%N())-((b.k-S.dealer-1+N())%N()));
  const position=order.length>1?order.findIndex(x=>x.k===i)/(order.length-1):1;
  const pre=S.board.length===0,strength=startingStrength(hole);
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
  if(!pre&&humanShove&&aggr>=.70&&eq>=.40)return {type:'call'};
  const raise=frac=>{
    let to=pre&&S.currentBet<=BB?BB*(2.5+(1-position)*.5)+S.seats.filter(q=>q!==p&&q.bet===BB).length*BB*.6
      :S.currentBet+Math.max(S.minRaise,(pot+toCall)*frac);
    to=Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),Math.round(to)));
    // Commit the last few chips only when already close to an all-in.
    if(to>p.bet+p.stack*.90)to=maxRaiseTo(p);
    return {type:'raise',to};
  };
  if(pre){
    const unopened=S.currentBet<=BB,depth=p.stack/BB;
    const openThreshold=.64-position*.13-(loose-.5)*.08;
    const premium=strength>=(S.raises>=3?.91:S.raises>=2?.82:.74);
    if(canR&&((unopened&&strength>openThreshold)||(premium&&eq>odds+.10))){
      if(depth<=12&&strength>.77)return {type:'raise',to:maxRaiseTo(p)};
      return raise(.65+aggr*.25);
    }
    if(!toCall)return {type:'check'};
    const realization=.74+position*.13+(suitOf(hole[0])===suitOf(hole[1])?.05:0);
    const margin=.025+(S.raises>=3?.06:0)-(loose-.5)*.025;
    return eq*realization>odds+margin?{type:'call'}:{type:'fold'};
  }
  const cards=hole.concat(S.board),suits=[0,0,0,0];cards.forEach(c=>suits[suitOf(c)]++);
  const ranks=new Set(cards.map(rankOf));if(ranks.has(14))ranks.add(1);
  let straightDraw=false;for(let low=1;low<=10;low++){let count=0;for(let r=low;r<low+5;r++)if(ranks.has(r))count++;if(count===4)straightDraw=true;}
  const draw=S.board.length<5&&(suits.includes(4)||straightDraw);
  const value=eq>(opp===1?.62:opp===2?.49:.40);
  const r=Math.random(),size=eq>.82?.85:.45+aggr*.22;
  if(!toCall){
    if(canR&&value&&r<.65+aggr*.3)return raise(size);
    if(canR&&opp<=2&&draw&&eq>.22&&r<.12+aggr*.18)return raise(.55);
    if(canR&&opp===1&&position>.7&&eq<.25&&r<.035+aggr*.035)return raise(.5);
    return {type:'check'};
  }
  const margin=(S.board.length===5?0:.025)+(opp>2?.025:0)-(loose-.5)*.025;
  if(eq<odds+margin)return {type:'fold'};
  if(canR&&eq>(opp===1?.75:.62)&&r<.55+aggr*.35)return raise(size);
  if(canR&&opp===1&&draw&&eq>.35&&toCall<pot*.4&&r<aggr*.12)return raise(.65);
  return {type:'call'};
}
