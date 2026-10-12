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
  const suited=suitOf(hole[0])===suitOf(hole[1]),hi=Math.max(...hole.map(rankOf)),lo=Math.min(...hole.map(rankOf));
  if(pre){
    const unopened=S.currentBet<=BB,depth=p.stack/BB,r0=Math.random(),later=position>=.6;
    // first-in ranges by position, as solvers open them: ~15% from the earliest seat up to ~45% last
    // (looser players a bit wider, Joe wider still)
    const rfi=Math.min(.62,(.15+position*.30)*(1+(loose-.5)*.6)+(tag?.10:0));
    const openT=topT(rfi);
    if(unopened){
      if(canR&&strength>=openT){
        if(depth<=12&&strength>.77)return {type:'raise',to:maxRaiseTo(p)};
        if(tag){ // Joe opens big: 12.5BB, or 25 / 37.5BB with good hands (25 / 50 / 75 at 1/2)
          const bbs=strength>=.66?(r0<.5?25:37.5):12.5;
          const to=Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),Math.round(BB*bbs)));
          return {type:'raise',to:to>p.bet+p.stack*.9?maxRaiseTo(p):to};
        }
        return raise(0);
      }
      // only one big blind to see the flop: the pot already lays great odds, so folding wastes them —
      // only the very worst hands let go sometimes
      if(toCall&&toCall<=BB)return strength>.20||r0<.6?{type:'call'}:{type:'fold'};
      return {type:'check'};
    }
    // Joe doubles a raise whenever his hand is decent
    if(tag&&canR&&S.raises===2&&strength>=topT(.22)&&eq>odds){
      const to=Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),S.currentBet*2));
      return {type:'raise',to:to>p.bet+p.stack*.9?maxRaiseTo(p):to};
    }
    // facing one raise: 3-bet about 10% — the top ~5% for value, the rest as bluffs with suited
    // blockers (suited aces/kings, suited broadways, suited connectors), wider against loose openers
    if(S.raises===2&&canR){
      const opener=S.seats[S.pfAgg],wide=opener&&read(opener).af>.25?.03:0;
      const bluffable=suited&&(hi>=13||(hi>=10&&lo>=10)||(hi-lo===1&&lo>=4));
      const valueHand=strength>=topT(.05+wide),bluff3=!valueHand&&bluffable&&r0<(later?.55:.3)*(.6+aggr*.8);
      if(valueHand||bluff3){
        const callers=Math.max(0,S.seats.filter(q=>q!==p&&q.bet===S.currentBet).length-1);
        const to=Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),Math.round(S.currentBet*(later?3:3.6)+callers*S.currentBet)));
        return {type:'raise',to:to>p.bet+p.stack*.6?maxRaiseTo(p):to};
      }
    }
    // facing a 3-bet: 4-bet the top ~2.5% (some A5s-type bluffs), jam the very top
    if(S.raises===3&&canR&&(strength>=topT(.025)||(suited&&hi===14&&lo<=5&&r0<.12+aggr*.15))){
      const to=Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),Math.round(S.currentBet*2.3)));
      return {type:'raise',to:to>p.bet+p.stack*.5||strength>=topT(.012)?maxRaiseTo(p):to};
    }
    if(S.raises>=4&&canR&&strength>=topT(.015))return {type:'raise',to:maxRaiseTo(p)};
    if(!toCall)return {type:'check'};
    // calling: pot odds against the raiser's range, with position and suitedness helping play the hand
    const realization=.74+position*.13+(suited?.05:0);
    const margin=.02+(S.raises>=3?.06:0)-(loose-.5)*.03+(commit>.35?.05:0);
    return eq*realization>odds+margin?{type:'call'}:{type:'fold'};
  }
  const cards=hole.concat(S.board),suits=[0,0,0,0];cards.forEach(c=>suits[suitOf(c)]++);
  const ranks=new Set(cards.map(rankOf));if(ranks.has(14))ranks.add(1);
  let straightDraw=false;for(let low=1;low<=10;low++){let count=0;for(let r=low;r<low+5;r++)if(ranks.has(r))count++;if(count===4)straightDraw=true;}
  const draw=S.board.length<5&&(suits.includes(4)||straightDraw);
  const street=S.board.length,river=street===5,last=position>=.99,inPos=position>=.6,tex=texture(S.board);
  const pfr=S.pfAgg===i,ledLast=S.prevAgg===i;
  // against calling stations: thinner value, bigger sizes, almost no bluffs
  const value=eq>(opp===1?(station?.52:.56):opp===2?(station?.43:.46):.38);
  const bluffy=(station?.15:1)*(tag?.6:1);
  const r=Math.random(),size=(station||tag)?(eq>.82?1:.8):eq>.82?.85:.5+aggr*.2;
  const checked=p.chk===S.hand+':'+street;
  if(!toCall){
    // out of position with a monster: sometimes check, planning to raise when someone bets
    if(canR&&!inPos&&eq>.78&&opp>=1&&!river&&r<.3+aggr*.12)return {type:'check'};
    // flop c-bet by the preflop raiser: small and often on dry high boards, less on wet / low
    // connected boards and into more players (Joe only when he still has something)
    if(street===3&&pfr&&canR&&opp<=3){
      const freq=(tex.dryHigh?.82:tex.wet?.45:.65)*(opp===1?1:opp===2?.65:.4);
      if(tag?eq>.40&&r<freq:r<freq*(eq>.3?1:bluffy))return raise(tex.dryHigh?.33:.6);
    }
    // donk lead (as Pluribus does): out of position on a low, connected board that suits the caller
    if(!river&&!inPos&&!pfr&&canR&&tex.low&&tex.connected&&(eq>.62||(draw&&eq>.3))&&r<.25+aggr*.15)return raise(.5);
    // probe: the flop was checked through, so nobody showed strength — in position, take the turn
    if(street===4&&S.prevAgg===-1&&canR&&inPos&&(eq>.3?r<.6:r<(.25+aggr*.2)*bluffy))return raise(.5);
    // second barrel: whoever led the flop keeps going on the turn with value and draws, some air
    if(street===4&&ledLast&&canR&&opp<=2&&(eq>.5||draw||(eq<.3&&r<.4*bluffy))&&r<.75)return raise(eq>.75?.75:.6);
    // river: last to act after everyone checked — bet value and bluffs, check back only the middle;
    // the nuts and some air go big (overbet), the bluff share follows the size (≈25% at half pot, 33% at pot)
    if(river&&last&&canR){
      if(eq>.88&&r<.35)return raise(1.25);
      if(eq>.45&&r<.85)return raise(eq>.7?.75:.5);
      if(eq<.35&&r<(.6+aggr*.3)*bluffy/(opp>2?1.6:1))return raise(r<.2?1.25:.6+aggr*.15);
    }
    if(canR&&value&&r<.7+aggr*.25)return raise(river&&eq>.9&&r<.25?1.25:size);
    if(river&&canR&&opp<=3){
      if(inPos&&eq>.5&&r<.65)return raise(.5);
      if(!inPos&&eq>.55&&r<.45)return raise(.4);                       // thin value from the front: small bet
      if(eq<.35&&r<((inPos?.45:.2)+aggr*.2)*bluffy/(opp>2?2:1))return raise(.6+aggr*.15);
    }
    // checked to me in position on the flop or turn: stab with a piece, sometimes with nothing
    if(!river&&canR&&inPos&&opp<=3&&(eq>.4?r<.55:r<(.22+aggr*.2)*bluffy))return raise(.5);
    // everyone checked to the last player in a bigger pot: someone has to bet — a piece usually, air now and then
    if(!river&&canR&&last&&(eq>.33?r<.72:r<(.2+aggr*.2)*bluffy))return raise(.45);
    // first to act in a multiway pot with a decent hand: bet for protection sometimes
    if(!river&&canR&&!inPos&&opp>=3&&eq>.42&&r<.3+aggr*.15)return raise(.5);
    if(canR&&opp<=2&&draw&&eq>.22&&r<(.18+aggr*.22)*bluffy)return raise(.55);
    return {type:'check'};
  }
  // facing a bet. Don't over-fold (minimum defense ≈ pot ÷ (pot + bet)); look up river bets from
  // players who bluff a little lighter.
  const bettor=S.seats.reduce((a,q)=>q.bet>(a?a.bet:-1)?q:a,null),aggro=bettor&&read(bettor).af>.22;
  const margin=(river?(aggro?-.04:-.01):.02)+(opp>2?.025:0)-(loose-.5)*.025+(tag?.03:0)+(commit>.35&&eq<.65?.05:0);
  // check-raise: I checked this street and now somebody bet — monsters and some strong draws
  if(checked&&canR&&(eq>.70||(draw&&eq>.35&&r<.3*aggr*bluffy))&&r<.8)return raise(eq>.82?.9:.75);
  if(eq<odds+margin){
    if(river&&canR&&opp===1&&last&&eq<.12&&r<.04*aggr*bluffy)return raise(1);   // rare river bluff-raise
    return {type:'fold'};
  }
  if(canR&&eq>(opp===1?.75:.62)&&r<.55+aggr*.35)return raise(size);
  if(canR&&opp===1&&draw&&eq>.35&&toCall<pot*.4&&r<aggr*.15)return raise(.65);
  return {type:'call'};
}

// startingStrength → share of all 1,326 starting hands: topT(.15) is the weakest hand in the top 15%
let RANKED=null;
export function topT(share){
  if(!RANKED){const all=[];for(let a=0;a<52;a++)for(let b=a+1;b<52;b++)all.push(startingStrength([a,b]));RANKED=all.sort((x,y)=>y-x);}
  return RANKED[Math.max(0,Math.min(RANKED.length-1,Math.floor(share*RANKED.length)))];
}
// board texture for c-bets and leads
export function texture(board){
  const rs=board.map(rankOf).sort((x,y)=>y-x),sc=[0,0,0,0];board.forEach(c=>sc[suitOf(c)]++);
  const uniq=[...new Set(rs)],paired=uniq.length<rs.length,suitMax=Math.max(...sc);
  const top3=uniq.slice(0,3),connected=top3.length>=3&&top3[0]-top3[top3.length-1]<=4;
  const high=rs[0]||0,wet=suitMax>=3||connected||(suitMax===2&&top3.length>=2&&top3[0]-top3[1]<=2);
  return {high,paired,suitMax,connected,wet,low:high<=9,dryHigh:high>=12&&!connected&&suitMax<=2&&!wet};
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

