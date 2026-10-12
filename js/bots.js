// Bot strategy.
import {best7,rankOf,suitOf} from './cards.js';
import {BOT_STYLE} from './config.js';
import {BB} from './settings.js';
import {H,S} from './state.js';
import {N,bookKey,canAct,canRaise,live,maxRaiseTo,minRaiseTo,potTotal} from './table.js';
import {botSay} from './talk.js';

// Estimates use only the acting bot's cards and publicly visible betting state, plus what everyone
// has shown so far (their 入池率 / 翻前加注 from the table stats).
// read(q): how often q raises before the flop (af) and how often q plays a hand (vp), shrunk toward
// typical values until there are enough hands to trust.
export function read(q){
  const st=(S.stats||{})[bookKey(q)]||{},h=st.h||0,k=15;
  return {af:((st.pr||0)+.15*k)/(h+k),vp:((st.vp||0)+.25*k)/(h+k)};
}
export function startingStrength(hole){
  const hi=Math.max(...hole.map(rankOf)),lo=Math.min(...hole.map(rankOf));
  if(hi===lo)return Math.min(.99,.50+(hi-2)*.041);
  const suited=suitOf(hole[0])===suitOf(hole[1]),gap=hi-lo;
  return Math.max(.05,Math.min(.95,(hi+lo-4)/30+(suited?.07:0)+(gap===1?.045:0)-Math.max(0,gap-2)*.025));
}
export function rangeEquity(hole,board,opponents,iters){
  if(!opponents.length)return 1;
  const known=new Set(hole.concat(board)),deck=Array.from({length:52},(_,c)=>c).filter(c=>!known.has(c));
  // how tight each opponent's range is: bigger public bets → stronger; a player who raises everything
  // preflop → wider. The preflop read can only widen a range after the flop (it says nothing about
  // how they shove later).
  const potNow=potTotal(),raises=Math.min(.18,Math.max(0,(S.raises||0)-1)*.06),pre=board.length===0;
  const tights=opponents.map(q=>{
    const pressure=q.bet>BB?Math.min(1,q.bet/Math.max(BB,potNow-q.bet)):0,adj=(.15-read(q).af)*1.1;
    return Math.max(.05,Math.min(.85,.25+pressure*.45+raises+(pre?adj:Math.min(0,adj))));
  });
  let wins=0;
  for(let t=0;t<iters;t++){
    const pool=deck.slice(),hands=[];
    const draw=()=>pool.splice(Math.floor(Math.random()*pool.length),1)[0];
    for(let o=0;o<opponents.length;o++){
      const tight=tights[o];
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
  CTX={pre,strength,eq:null,toCall,pot,canR,position,street:S.board.length,raises:S.raises||0,checked:p.chk===S.hand+':'+S.board.length};
  const eq=rangeEquity(hole,S.board,opponents,Math.max(180,Math.floor(650/(opp+1))));
  // calling stations: players who play lots of hands but rarely raise
  const station=opponents.length>0&&opponents.every(q=>{const x=read(q);return x.vp>.55&&x.af<.12;});
  // a call that commits a big part of the stack needs more than bare pot odds
  const commit=toCall/Math.max(1,p.stack+p.bet);
  Object.assign(CTX,{eq,opp,station});
  const raise=frac=>{
    let to=pre&&S.currentBet<=BB?BB*((tag?4:2.5)+(1-position)*.5)+S.seats.filter(q=>q!==p&&q.bet===BB).length*BB*(tag?1:.6)
      :S.currentBet+Math.max(S.minRaise,(pot+toCall)*frac);
    to=Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),Math.round(to)));
    // Commit the last few chips only when already close to an all-in.
    if(to>p.bet+p.stack*.90)to=maxRaiseTo(p);
    return {type:'raise',to};
  };
  // sc: sees almost every flop cheaply and folds to a bet the moment his hand isn't good.
  // With a big hand he likes to check-call, or bet just a little — under 25BB (50 at 1/2) unless he has the nuts.
  if(type==='peeker'){
    const nuts=!pre&&eq>.93,big=pre?strength>.80:eq>.75,r=Math.random();
    const small=()=>{
      if(nuts)return raise(.9);
      const to=Math.min(S.currentBet+Math.max(S.minRaise,Math.round((pot+toCall)*.3)),Math.round(BB*25)-1,maxRaiseTo(p));
      return to>=minRaiseTo(p)?{type:'raise',to}:null;
    };
    if(pre){
      if(!toCall)return {type:'check'};
      if(big&&canR&&r<.3){const x=small();if(x)return x;}
      return big||toCall<=BB*6||strength>.62?{type:'call'}:{type:'fold'};
    }
    if(!toCall){
      if(big&&canR&&r<.35){const x=small();if(x)return x;}
      return {type:'check'};                    // a big hand is usually checked, then called down
    }
    if(nuts&&canR&&r<.5)return raise(.9);
    if(big)return {type:'call'};                // check-call, no raise
    return eq>.55?{type:'call'}:{type:'fold'};
  }
  // 奶龙 (土豪): sticky and loves to see cards — but not every single time, and without a big hand
  // he won't put in big money (over half the pot, over 15% of his stack, or into a raise).
  if(type==='whale'){
    const r=Math.random(),big=pre?strength>.85:eq>.80;
    if(canR&&big&&r<(toCall?.35:.5))return raise(.6);
    if(!toCall)return {type:'check'};
    const made=pre?0:Math.floor(best7(hole.concat(S.board))/Math.pow(16,5));
    if(S.board.length===5&&made<2&&eq<.5)return {type:'fold'};          // river: two pair or a real chance
    if(pre){                                                              // sees most flops, but not for a fortune
      const bbs=toCall/BB;
      if(bbs>20)return strength>.66?{type:'call'}:{type:'fold'};
      if(bbs>8)return strength>.50||r<.25?{type:'call'}:{type:'fold'};
      return strength<.40&&r<.18?{type:'fold'}:{type:'call'};
    }
    // big money after the flop: over half the pot, over 15% of his stack, or any raise
    const huge=toCall>Math.min(pot*.5,(p.stack+p.bet)*.15)||(S.raises||0)>=2;
    if(huge)return made>=2||eq>odds+.06?{type:'call'}:{type:'fold'};
    return eq>odds-.08||r<.4?{type:'call'}:{type:'fold'};                  // sticks with pairs, draws, often air
  }
  if(pre){
    const unopened=S.currentBet<=BB,depth=p.stack/BB;
    const openThreshold=tag?.62-position*.06:.64-position*.13-(loose-.5)*.08;
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
    const suited=suitOf(hole[0])===suitOf(hole[1]),hi=Math.max(...hole.map(rankOf)),lo=Math.min(...hole.map(rankOf));
    const r0=Math.random(),later=position>=.6;
    if(unopened){
      // open-raise: tighter up front, wider late; late position steals more when nobody has come in
      const limpers=S.seats.filter(q=>q!==p&&q.bet===BB&&q.acted).length;
      const steal=later&&!limpers&&strength>.45&&r0<.35+aggr*.4;
      if(canR&&(strength>openThreshold||steal)){
        if(depth<=12&&strength>.77)return {type:'raise',to:maxRaiseTo(p)};
        return raise(0);
      }
      // seeing a flop for one big blind is cheap: most hands come along
      if(toCall&&toCall<=BB)return strength>.30-(loose-.5)*.12||r0<.25?{type:'call'}:{type:'fold'};
      return {type:'check'};
    }
    // facing a raise: 3-bet for value, sometimes as a bluff with suited aces / suited connectors in position
    if(S.raises===2&&canR){
      const bluffable=suited&&(hi===14||(hi>=10&&lo>=10)||(hi-lo===1&&lo>=4));
      const bluff3=bluffable&&strength<.72&&r0<(later?.38:.18)+aggr*.3;
      if(strength>=.72||bluff3){
        const callers=S.seats.filter(q=>q!==p&&q.bet===S.currentBet).length-1;
        const to=Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),Math.round(S.currentBet*(later?3:3.6)+Math.max(0,callers)*S.currentBet)));
        return {type:'raise',to:to>p.bet+p.stack*.6?maxRaiseTo(p):to};
      }
    }
    // facing a 3-bet: 4-bet the top of the range, jam the very top
    if(S.raises===3&&canR&&(strength>=.88||(strength>=.84&&r0<aggr*.5))){
      const to=Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),Math.round(S.currentBet*2.3)));
      return {type:'raise',to:to>p.bet+p.stack*.5||strength>=.93?maxRaiseTo(p):to};
    }
    if(S.raises>=4&&canR&&strength>=.93)return {type:'raise',to:maxRaiseTo(p)};
    if(!toCall)return {type:'check'};
    const realization=.74+position*.13+(suited?.05:0);
    const margin=.025+(S.raises>=3?.06:0)-(loose-.5)*.025+(tag?.05:0)+(commit>.35?.05:0);
    return eq*realization>odds+margin?{type:'call'}:{type:'fold'};
  }
  const cards=hole.concat(S.board),suits=[0,0,0,0];cards.forEach(c=>suits[suitOf(c)]++);
  const ranks=new Set(cards.map(rankOf));if(ranks.has(14))ranks.add(1);
  let straightDraw=false;for(let low=1;low<=10;low++){let count=0;for(let r=low;r<low+5;r++)if(ranks.has(r))count++;if(count===4)straightDraw=true;}
  const draw=S.board.length<5&&(suits.includes(4)||straightDraw);
  const river=S.board.length===5,last=position>=.99,inPos=position>=.6;
  // against calling stations: thinner value bets, bigger sizes, almost no bluffs
  const value=eq>(opp===1?(station?.55:.6):opp===2?(station?.45:.48):.40);
  const bluffy=(station?.15:1)*(tag?.5:1);
  const r=Math.random(),size=(station||tag)?(eq>.82?1:.8):eq>.82?.85:.5+aggr*.2;
  const checked=p.chk===S.hand+':'+S.board.length;
  if(!toCall){
    // out of position with a monster: sometimes check to raise when someone bets
    if(canR&&!inPos&&eq>.78&&opp>=1&&!river&&r<.35+aggr*.15)return {type:'check'};
    if(canR&&value&&r<.7+aggr*.25)return raise(size);
    // Joe c-bets the flop when he was the last preflop raiser and still has something
    if(tag&&canR&&S.board.length===3&&S.pfAgg===i&&opp<=2&&eq>.40&&r<.6)return raise(.55);
    // river, checked to me: thin value in position, and bluffs with hands that cannot win at showdown
    // last to act on the river and everyone checked: their hands are capped — bet value and bluffs,
    // check back only the middle (hands that win some showdowns but would not get called by worse)
    if(river&&last&&canR){
      if(eq>.45&&r<.85)return raise(eq>.7?.75:.5);
      if(eq<.35&&r<(.55+aggr*.3)*bluffy/(opp>2?1.6:1))return raise(.6+aggr*.15);
    }
    if(river&&canR&&opp<=3){
      if(inPos&&eq>.5&&r<.65)return raise(.5);
      if(eq<.35&&r<((last?.65:inPos?.45:.2)+aggr*.2)*bluffy/(opp>2?2:1))return raise(.6+aggr*.15);
    }
    // turn: stab in position when everyone checked
    if(S.board.length===4&&canR&&inPos&&opp<=2&&eq<.4&&r<(.15+aggr*.2)*bluffy)return raise(.5);
    if(canR&&opp<=2&&draw&&eq>.22&&r<(.18+aggr*.22)*bluffy)return raise(.55);
    if(canR&&opp===1&&last&&eq<.25&&r<(.08+aggr*.08)*bluffy)return raise(.5);
    return {type:'check'};
  }
  // calling: a river bet from someone who bluffs gets looked up a little lighter
  const bettor=S.seats.reduce((a,q)=>q.bet>(a?a.bet:-1)?q:a,null),aggro=bettor&&read(bettor).af>.22;
  const margin=(river?(aggro?-.03:0):.025)+(opp>2?.025:0)-(loose-.5)*.025+(tag?.04:0)+(commit>.35&&eq<.65?.05:0);
  // check-raise: I checked this street and now somebody bet
  if(checked&&canR&&(eq>.70||(draw&&eq>.35&&r<.25*aggr*bluffy))&&r<.8)return raise(eq>.82?.9:.75);
  if(eq<odds+margin){
    if(river&&canR&&opp===1&&last&&eq<.12&&r<.04*aggr*bluffy)return raise(1);   // rare river bluff-raise
    return {type:'fold'};
  }
  if(canR&&eq>(opp===1?.75:.62)&&r<.55+aggr*.35)return raise(size);
  if(canR&&opp===1&&draw&&eq>.35&&toCall<pot*.4&&r<aggr*.15)return raise(.65);
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
  const d=pick(p,i);
  if(d.type==='check')p.chk=S.hand+':'+S.board.length;   // remembered for a check-raise later this street
  if(globalThis.__botTrace)globalThis.__botTrace(p,d,CTX);  // tools/simulate.js --behaviour
  return d;
}
function pick(p,i){
  const d=decideCore(p,i),{type}=BOT_STYLE[p.name]||{};
  if(type!=='bluffer')return d;
  if((p.real||0)>=REAL_HANDS&&CTX.canR){
    const r=Math.random(),weak=CTX.pre?CTX.strength<.6:(CTX.eq??0)<.5;
    const spot=CTX.pre?r<.5:!CTX.toCall?r<.8:r<.4;
    if(weak&&spot&&d.type!=='raise'&&(CTX.opp||0)<=2&&!CTX.station){
      p.bl=(p.bl||0)+1;p.bluffs=(p.bluffs||0)+1;botSay(p,'bluff',.85);
      if(p.bl>=BLUFFS){p.real=0;p.bl=0;}
      return {type:'raise',to:bluffTo(p,CTX.pre?.8:.75)};
    }
  }
  const real=CTX.pre?CTX.strength>.74:(CTX.eq??0)>.6;
  if(real&&(d.type==='raise'||d.type==='call'))p.real=(p.real||0)+1;
  return d;
}

