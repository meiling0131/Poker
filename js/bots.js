// Bot strategy: one sound core, six personalities on top.
//
// The core plays the way solvers do, from public information only (its own cards, the board, what
// everyone has done this hand, and the table stats): opening ranges by position, 3-bets that are
// polarised (value plus suited blockers), calls by pot odds against the raiser's range, c-bets sized
// by texture, barrels and probes, bluffs in proportion to the bet size, and a defence that does not
// fold more than the minimum (pot ÷ (pot + bet)). Every opponent's range is modelled from their
// actions so far: an open-raiser is narrower than a limper, a 3-bettor narrower still, a player who
// bets every street has something. The core returns a distribution over the legal actions; the
// personality then bends those weights (奶龙 calls more, sc never raises without the nuts, Joe sizes
// up, Kmetsch runs bluffs) but can only shift probability between options the core already allows at
// a reasonable price, so a bot keeps its character without giving its chips away.
import {best7,rankOf,suitOf} from './cards.js';
import {BOT_STYLE} from './config.js';
import {BB} from './settings.js';
import {H,S} from './state.js';
import {N,bookKey,canAct,canRaise,live,maxRaiseTo,minRaiseTo,potTotal} from './table.js';
import {botSay} from './talk.js';

// ---- reads: the table stats everyone can see, shrunk toward typical values until there is history ----
// af: raises before the flop · vp: plays a hand · agg: bets or raises after the flop
export function read(q){
  const st=(S.stats||{})[bookKey(q)]||{},h=st.h||0,k=15,pa=st.pa||0;
  return {af:((st.pr||0)+.15*k)/(h+k),vp:((st.vp||0)+.25*k)/(h+k),agg:((st.pb||0)+.35*k)/(pa+k)};
}
export function startingStrength(hole){
  const hi=Math.max(...hole.map(rankOf)),lo=Math.min(...hole.map(rankOf));
  if(hi===lo)return Math.min(.99,.50+(hi-2)*.041);
  const suited=suitOf(hole[0])===suitOf(hole[1]),gap=hi-lo;
  return Math.max(.05,Math.min(.95,(hi+lo-4)/30+(suited?.07:0)+(gap===1?.045:0)-Math.max(0,gap-2)*.025));
}
// startingStrength → share of all 1,326 starting hands: topT(.15) is the weakest hand in the top 15%
let RANKED=null;
export function topT(share){
  if(!RANKED){const all=[];for(let a=0;a<52;a++)for(let b=a+1;b<52;b++)all.push(startingStrength([a,b]));RANKED=all.sort((x,y)=>y-x);}
  return RANKED[Math.max(0,Math.min(RANKED.length-1,Math.floor(share*RANKED.length)))];
}

// ---- an opponent's range, from what they have done this hand ----
// pre: how tight their starting hands are (0 = any two, 1 = only the very top), from their preflop
// actions (limp, call an open, open-raise, 3-bet, 4-bet). post: how much their hand must connect with
// the board, from every bet, raise or call after the flop. Reads shift both: a player who raises a lot
// opens wider; one who rarely bets after the flop means it when they do.
export function rangeTight(q){
  const h=q.hist||[],rd=read(q);
  let pre=.18,post=0,preRaises=0,preCallLevel=0;
  for(const a of h){
    if(a.s!==0)continue;
    if(a.t==='raise')preRaises++;else if(a.t==='call')preCallLevel=Math.max(preCallLevel,a.r);
  }
  if(preRaises)pre=[0,.45,.62,.78,.88][Math.min(4,preRaises)]-(rd.af-.15)*1.2;
  else if(preCallLevel>=3)pre=.58;
  else if(preCallLevel===2)pre=.42-(rd.vp-.25)*.4;
  else if(preCallLevel===1)pre=.25;
  for(const a of h){
    if(a.s===0)continue;
    const late=a.s===5?.08:a.s===4?.04:0;                     // the later the street, the more an action says
    if(a.t==='raise')post+=(a.r>=1?.42:.3)+late+(rd.agg<.2?.08:rd.agg>.5?-.06:0);   // a raise over a bet: stronger still
    else if(a.t==='call')post+=.15+late;                        // calling a bet means the board is hit, or a draw
    else if(a.t==='check')post-=.05;
  }
  return {pre:Math.max(.08,Math.min(.92,pre)),post:Math.max(0,Math.min(.95,post))};
}
// hand category of every two-card combo on this board, computed once per board and shared by all bots
let CAT_KEY='',CAT=null;
function categories(board){
  const key=board.join(',');
  if(key===CAT_KEY&&CAT)return CAT;
  const arr=new Uint8Array(52*52);
  if(board.length>=3){
    const on=new Set(board);
    for(let a=0;a<52;a++){if(on.has(a))continue;for(let b=a+1;b<52;b++){if(on.has(b))continue;arr[a*52+b]=1+Math.floor(best7([a,b].concat(board))/Math.pow(16,5));}}
  }
  CAT_KEY=key;CAT=arr;return arr;
}
// cumulative weights of every combo for one opponent: starting strength against pre, board connection against post
function rangeWeights(q,board,combos){
  const {pre,post}=rangeTight(q),cat=categories(board),cum=new Float64Array(combos.length);
  const suits=[0,0,0,0];board.forEach(c=>suits[suitOf(c)]++);
  let acc=0;
  for(let k=0;k<combos.length;k++){
    const [a,b]=combos[k];
    const wp=Math.max(.01,Math.min(1,1+startingStrength(combos[k])-2*pre));
    let wq=1;
    if(board.length>=3){
      let str=.23+(cat[a*52+b]-1)*.18;
      if(board.length<=4){   // a flush draw plays like a medium hand (the semi-bluffing part of a range)
        const sa=suitOf(a),sb=suitOf(b);
        if(suits[sa]+1+(sa===sb?1:0)>=4||suits[sb]+1+(sa===sb?1:0)>=4)str=Math.max(str,.5);
      }
      wq=post<=0?1:Math.max(.01,Math.pow(Math.max(0,Math.min(1,(Math.min(.98,str)-post*1.5+.55)/.55)),2));
    }
    acc+=wp*wq;cum[k]=acc;
  }
  return cum;
}
const pickFrom=(cum,combos)=>{let lo=0,hi=cum.length-1;const x=Math.random()*cum[hi];while(lo<hi){const mid=(lo+hi)>>1;if(cum[mid]<x)lo=mid+1;else hi=mid;}return combos[lo];};
export function rangeEquity(hole,board,opponents,iters){
  if(!opponents.length)return 1;
  const known=new Set(hole.concat(board)),deck=Array.from({length:52},(_,c)=>c).filter(c=>!known.has(c));
  const combos=[];for(let a=0;a<deck.length;a++)for(let b=a+1;b<deck.length;b++)combos.push([deck[a],deck[b]]);
  const tables=opponents.map(q=>rangeWeights(q,board,combos));
  let wins=0;
  for(let t=0;t<iters;t++){
    const used=new Set(),hands=[];
    for(const cum of tables){
      let h;
      for(let tries=0;tries<20;tries++){h=pickFrom(cum,combos);if(!used.has(h[0])&&!used.has(h[1]))break;}
      if(used.has(h[0])||used.has(h[1]))h=deck.filter(c=>!used.has(c)).slice(0,2);
      used.add(h[0]);used.add(h[1]);hands.push(h);
    }
    const rest=deck.filter(c=>!used.has(c)),run=board.slice();
    while(run.length<5)run.push(rest.splice(Math.floor(Math.random()*rest.length),1)[0]);
    const mine=best7(hole.concat(run));let ties=1,lost=false;
    for(const h of hands){const score=best7(h.concat(run));if(score>mine){lost=true;break;}if(score===mine)ties++;}
    if(!lost)wins+=1/ties;
  }
  return wins/iters;
}
// board texture for c-bets and leads
export function texture(board){
  const rs=board.map(rankOf).sort((x,y)=>y-x),sc=[0,0,0,0];board.forEach(c=>sc[suitOf(c)]++);
  const uniq=[...new Set(rs)],paired=uniq.length<rs.length,suitMax=Math.max(...sc);
  const top3=uniq.slice(0,3),connected=top3.length>=3&&top3[0]-top3[top3.length-1]<=4;
  const high=rs[0]||0,wet=suitMax>=3||connected||(suitMax===2&&top3.length>=2&&top3[0]-top3[1]<=2);
  return {high,paired,suitMax,connected,wet,low:high<=9,dryHigh:high>=12&&!connected&&suitMax<=2&&!wet};
}
// my draws (flop and turn): a flush draw with one of my cards, open-ended or gutshot straight draw, overcards
export function draws(hole,board){
  const none={fd:false,oesd:false,gut:false,overs:0,draw:false};
  if(board.length<3||board.length>4)return none;
  const cards=hole.concat(board),suits=[0,0,0,0];cards.forEach(c=>suits[suitOf(c)]++);
  const fd=suits.some((n,s)=>n===4&&hole.some(c=>suitOf(c)===s));
  const ranks=new Set(cards.map(rankOf));if(ranks.has(14))ranks.add(1);
  let oesd=false,gut=false;
  for(let low=1;low<=10;low++){
    const miss=[];for(let r=low;r<low+5;r++)if(!ranks.has(r))miss.push(r);
    if(miss.length!==1)continue;
    if((miss[0]===low&&low>1)||(miss[0]===low+4&&low<10))oesd=true;else gut=true;
  }
  const bmax=Math.max(...board.map(rankOf)),overs=hole.filter(c=>rankOf(c)>bmax).length;
  return {fd,oesd,gut,overs,draw:fd||oesd||gut};
}

// ---- the situation, as the acting bot sees it ----
let CTX={};
function situation(p,i){
  const opponents=live().filter(q=>q!==p),opp=opponents.length,hole=H[i];
  const style=BOT_STYLE[p.name]||{loose:.5,aggr:.5},{loose,aggr,type}=style;
  const toCall=Math.min(Math.max(0,S.currentBet-p.bet),p.stack),pot=potTotal(),canR=canRaise(p);
  const eligible=S.seats.reduce((sum,q)=>sum+Math.min(q.total,p.total+toCall),0);   // side-pot money this stack cannot win is not in its price
  const odds=toCall/(eligible+toCall||1);
  const active=S.seats.map((q,k)=>({q,k})).filter(({q})=>canAct(q));
  const order=active.sort((a,b)=>((a.k-S.dealer-1+N())%N())-((b.k-S.dealer-1+N())%N()));
  const position=order.length>1?order.findIndex(x=>x.k===i)/(order.length-1):1;
  const pre=S.board.length===0,street=S.board.length,river=street===5,strength=startingStrength(hole);
  const eq=rangeEquity(hole,S.board,opponents,Math.max(160,Math.floor(600/(opp+1))));
  const station=opp>0&&opponents.every(q=>{const x=read(q);return x.vp>.55&&x.af<.12;});
  const bettor=S.seats.reduce((a,q)=>q!==p&&q.bet>(a?a.bet:-1)?q:a,null),bettorRead=bettor?read(bettor):null;
  const effective=Math.max(0,...opponents.map(q=>q.stack+q.bet));
  const depth=Math.min(p.stack+p.bet,effective||p.stack+p.bet)/BB;
  const suited=suitOf(hole[0])===suitOf(hole[1]),hi=Math.max(...hole.map(rankOf)),lo=Math.min(...hole.map(rankOf));
  const limpers=pre?S.seats.filter(q=>q!==p&&(q.hist||[]).some(a=>a.s===0&&a.t==='call'&&a.r<=1)).length:0;
  const callers=pre?Math.max(0,S.seats.filter(q=>q!==p&&q.bet===S.currentBet&&S.currentBet>BB).length-1):0;
  return {p,i,hole,opponents,opp,loose,aggr,type,tag:type==='tag',toCall,pot,odds,canR,position,inPos:position>=.6,last:position>=.99,
    pre,street,river,strength,eq,station,bettor,bettorRead,depth,suited,hi,lo,limpers,callers,
    raises:S.raises||0,pfr:S.pfAgg===i,ledLast:S.prevAgg===i,checked:p.chk===S.hand+':'+street,
    commit:toCall/Math.max(1,p.stack+p.bet),spr:p.stack/Math.max(1,pot+toCall),
    made:pre?0:Math.floor(best7(hole.concat(S.board))/Math.pow(16,5)),dr:draws(hole,S.board),tex:texture(S.board)};
}

// ---- a distribution over the legal actions ----
// {fold, call (check when nothing to call), raise:[{w,frac|to}]}: weights, normalised when sampled.
const mix=()=>({fold:0,call:0,raise:[]});
const bet=(m,w,frac,to)=>{if(w>0)m.raise.push({w,frac,to});};
// facing a bet the weights are relative to the call (or fold) weight of 1: odds(P) is the weight
// that makes the raise happen with probability P
const odds=P=>{P=Math.min(.95,Math.max(0,P));return P/(1-P);};
function raiseTo(c,frac,to){
  const p=c.p;
  if(to==null)to=c.pre&&S.currentBet<=BB?BB*(2.5+(1-c.position)*.5)+c.limpers*BB:S.currentBet+Math.max(S.minRaise,(c.pot+c.toCall)*frac);
  to=Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),Math.round(to)));
  if(to>p.bet+p.stack*.85)to=maxRaiseTo(p);        // the last few chips go in with the raise
  return to;
}

function corePre(c){
  const m=mix(),{strength,position,raises,toCall,eq,depth,canR,suited,hi,lo,loose,tag,aggr,commit,callers,limpers}=c;
  const unopened=S.currentBet<=BB,later=position>=.6;
  // first-in ranges by position, as solvers open them: ~15% from the earliest seat up to ~45% last;
  // looser players a bit wider; limpers ahead are isolated with a slightly tighter range
  const rfi=Math.min(.62,(.15+position*.30)*(1+(loose-.5)*.6)*(limpers?.85:1));
  if(unopened){
    if(canR&&strength>=topT(rfi)){
      if(depth<=12)bet(m,1,0,strength>=topT(rfi*.7)?maxRaiseTo(c.p):undefined);   // short: open-jam the top, else a normal open
      else bet(m,1,0);
      return m;
    }
    // one big blind (or completing the small blind) to see the flop: the pot lays good odds, so a hand
    // worth playing comes along, the junk mostly folds
    if(toCall&&toCall<=BB){
      const half=toCall<BB;
      m.call=Math.min(.95,(strength>.42?.9:strength>.30?(half?.8:.55)+limpers*.08:strength>.20?(half?.45:.2):(half?.2:.05))*(.5+loose));
      m.fold=1-m.call;return m;
    }
    m.call=1;return m;   // check the big blind
  }
  // short stacks: jam or fold, no calling
  if(depth<=12){
    if(canR&&strength>=topT(raises>=3?.04:.10))bet(m,odds(.95),0,maxRaiseTo(c.p));
    if(eq>c.odds+.08&&commit>.5)m.call=1;else m.fold=1;
    return m;
  }
  if(raises===2&&canR){
    // facing one raise: 3-bet about 10% — the top ~5% for value, the rest as bluffs with suited blockers
    // (suited aces/kings, suited broadways, suited connectors), wider against loose openers, tighter with callers
    const opener=S.seats[S.pfAgg],wide=opener&&read(opener).af>.25?.03:0;
    const bluffable=suited&&(hi>=13||(hi>=10&&lo>=10)||(hi-lo===1&&lo>=4));
    const huge=S.currentBet>=BB*8;
    const valueHand=strength>=topT(huge?.025:.05+wide-callers*.01);
    const size=S.currentBet*(later?3:3.6)+callers*S.currentBet;
    if(valueHand)bet(m,odds(.85),0,size);
    else if(bluffable&&!callers&&!huge)bet(m,odds((later?.5:.28)*(.6+aggr*.8)),0,size);
  }
  // facing a 3-bet: 4-bet the top ~2.5% and some A5s-type blockers, jam the very top; facing a 4-bet: jam QQ+/AK
  if(raises===3&&canR&&(strength>=topT(.025)||(suited&&hi===14&&lo<=5)))
    bet(m,odds(strength>=topT(.025)?.9:.12+aggr*.15),0,strength>=topT(.012)?maxRaiseTo(c.p):S.currentBet*2.3);
  if(raises>=4&&canR&&strength>=topT(.015))bet(m,odds(.92),0,maxRaiseTo(c.p));
  if(!toCall){m.call=1;return m;}
  // calling: pot odds against the raiser's range, with position and suitedness helping play the hand
  const realization=.74+position*.13+(suited?.05:0);
  const margin=.02+(raises>=3?.06:0)-(loose-.5)*.03+(commit>.35?.05:0)+(tag?.02:0)+(S.currentBet>=BB*8?.05:0);
  const ok=eq*realization>c.odds+margin;
  m.call=ok?1:0;m.fold=ok?0:1;
  // the raise weights above are relative to a call: value raises dominate, bluffs are a share
  return m;
}

function corePost(c){
  const m=mix(),{eq,opp,toCall,pot,canR,inPos,last,river,street,pfr,ledLast,checked,tex,dr,station,commit,spr,aggr,tag,loose,bettorRead}=c;
  const draw=dr.draw;
  // bluffs are rarer into calling stations and into a crowd; Joe bluffs less by nature
  const bluffy=(station?.15:1)*(tag?.6:1)*(opp>2?.5:1)*(river?1.25:1);
  // the price of a bluff-catch sets how many bluffs a balanced bettor has: size ÷ (1 + size)
  const alpha=s=>s/(1+s);
  const vT=opp===1?(station?.5:river?.52:.56):opp===2?(station?.43:.46):.38;   // bet for value above this (thinner on the river)
  const air=eq<(river?.30:.33);
  if(!toCall){
    const size=river?(eq>.9?1.25:eq>.7?.75:.5):street===3?(tex.dryHigh?.33:.66):.66;
    // value: bet most of the time; out of position with a monster sometimes check to raise;
    // when the bet would be most of the stack, only a hand that wants to get it in
    if(canR&&eq>vT){
      let w=.68+aggr*.2+(eq>.8?.1:0)-(opp>=3?.15:0);
      if(!inPos&&eq>.78&&!river&&opp>=1)w-=.3+aggr*.12;
      const frac=(station||tag)?(eq>.82?1:.8):size;
      if((pot+toCall)*frac>c.p.stack*.5&&eq<.64)w*=.25;
      bet(m,w,frac);
    }
    // flop c-bet by the preflop raiser: small and often on dry high boards, less on wet / low boards
    // and into more players; with air it is a bluff at the size's share
    if(street===3&&pfr&&canR&&opp<=3&&eq<=vT){
      const f=(tex.dryHigh?.82:tex.wet?.45:.65)*(opp===1?1:opp===2?.65:.4);
      bet(m,air?f*alpha(tex.dryHigh?.33:.6)*1.6*bluffy:f*(tag&&eq<.4?0:1),tex.dryHigh?.33:.6);
    }
    // semi-bluff: a draw bets the flop or turn, sized to fold out better hands now
    if(!river&&draw&&canR&&eq<=vT&&opp<=2)bet(m,(.3+aggr*.25)*bluffy*(dr.fd||dr.oesd?1:.5),.6);
    // donk lead (as Pluribus does): out of position on a low, connected board that suits the caller
    if(!river&&!inPos&&!pfr&&canR&&tex.low&&tex.connected&&(eq>.62||(draw&&eq>.3)))bet(m,.25+aggr*.15,.5);
    // probe: the flop was checked through, so nobody showed strength — in position, take the turn
    if(street===4&&S.prevAgg===-1&&canR&&inPos)bet(m,eq>.3?.6:(.25+aggr*.2)*bluffy,.5);
    // second barrel: whoever led the flop keeps going on the turn with value, draws and some air
    if(street===4&&ledLast&&canR&&opp<=2&&eq<=vT)bet(m,(draw?.6:air?.35*bluffy:.45)*.75,eq>.75?.75:.6);
    // river, last to act after everyone checked: value and bluffs, check back only the middle;
    // the nuts and some air go big (overbet); bluffs follow the size (≈25% at half pot, 33% at pot)
    if(river&&last&&canR){
      if(eq>.88)bet(m,.35,1.25);
      else if(eq>.45&&eq<=vT)bet(m,.85,eq>.7?.75:.5);
      else if(air){bet(m,(.5+aggr*.3)*bluffy*alpha(.6)*1.6,.6);bet(m,.15*bluffy,1.25);}
    }else if(river&&canR&&opp<=3){
      if(inPos&&eq>.5&&eq<=vT)bet(m,.65,.5);
      if(!inPos&&eq>.55&&eq<=vT)bet(m,.45,.4);                         // thin value from the front: small bet
      if(air)bet(m,((inPos?.45:.2)+aggr*.2)*bluffy*alpha(.6)*1.4,.6+aggr*.15);
    }
    // checked to me in position on the flop or turn: stab with a piece, sometimes with nothing
    if(!river&&canR&&inPos&&opp<=3&&eq<=vT)bet(m,eq>.4?.55:(.22+aggr*.2)*bluffy,.5);
    // everyone checked to the last player in a bigger pot: someone has to bet
    if(!river&&canR&&last&&eq<=vT)bet(m,eq>.33?.72:(.2+aggr*.2)*bluffy,.45);
    // first to act in a multiway pot with a decent hand: bet for protection sometimes
    if(!river&&canR&&!inPos&&opp>=3&&eq>.42&&eq<=vT)bet(m,.3+aggr*.15,.5);
    m.call=1;    // check: whatever the bets leave over (bet weights are capped when sampled)
    return m;
  }
  // facing a bet: defend at least the minimum (pot ÷ (pot + bet)) against a balanced bettor; fold a
  // little more to a player who rarely bets without it, call a little lighter against one who bets everything
  const passive=bettorRead&&bettorRead.agg<.22,aggro=bettorRead&&bettorRead.agg>.5,raised=c.raises>=2;
  const margin=(river?-.01:.02)+(opp>2?.025:0)-(loose-.5)*.025+(tag?.03:0)+(commit>.35&&eq<.65?.05:0)
    +(passive?(street>=4?.07:.03):0)-(aggro?.04:0)+(spr<1.5&&eq>.5?-.03:0)+(raised?(river?.1:.06):0);
  if(eq<c.odds+margin){
    m.fold=1;
    if(river&&canR&&opp===1&&last&&eq<.12)bet(m,odds(.04*aggr*bluffy),1);        // rare river bluff-raise
    return m;
  }
  m.call=1;
  // raise: strong hands (check-raise when I checked this street), strong draws at a good price
  const vR=raised?.88:opp===1?.72:.62;
  if(canR&&(eq>vR||(checked&&!raised&&eq>.7)))bet(m,odds((.5+aggr*.35)*(checked?1.25:1)*(raised?.8:1)),eq>.82?.9:.75);
  if(canR&&opp===1&&draw&&(dr.fd||dr.oesd)&&eq>.35&&toCall<pot*.4&&!river)bet(m,odds(aggr*.2*bluffy*(checked?1.5:1)),.65);
  return m;
}

// ---- personalities: bend the core's weights, never past a sound price ----
function personality(m,c){
  const {type,eq,toCall,pot,pre,strength,odds,raises,p,river,canR}=c;   // odds: the pot odds of the call
  const scaleRaises=(k,keep)=>{m.raise.forEach(r=>{if(!(keep&&keep(r)))r.w*=k;});};
  if(type==='whale'){
    // 奶龙: sticky and loves to see cards, but big money needs a big hand. Close folds at a fair price
    // become calls; raises are rarer unless the hand is huge; huge bets with nothing are still folded.
    const cheap=pre?toCall<=BB*6:toCall<=Math.min(pot*.4,(p.stack+p.bet)*.12)&&raises<2;
    const close=pre?strength>.38:eq>odds-.08&&!(river&&c.made<2&&eq<.5);
    if(m.fold>0&&cheap&&close){m.call+=m.fold*.5;m.fold*=.5;}
    if(m.fold>0&&pre&&toCall<=BB&&strength>.2){m.call+=m.fold*.8;m.fold*=.2;}
    scaleRaises(.6,r=>eq>.85||strength>.85);
  }else if(type==='peeker'){
    // sc: sees cheap flops, folds the moment the hand isn't good, and with a big hand check-calls or
    // bets small (under 25BB unless the nuts)
    if(pre&&m.fold>0&&toCall<=BB*6&&strength>.3){m.call+=m.fold*.85;m.fold*=.15;}
    const nuts=!pre&&eq>.93;
    m.raise.forEach(r=>{
      if(nuts)return;
      const to=r.to!=null?r.to:S.currentBet+Math.max(S.minRaise,(pot+toCall)*(r.frac||.5));
      if(to<BB*25&&!toCall)r.w*=.4;else r.w*=0;            // small bets only when nobody has bet
    });
    if(!pre&&eq>.75&&!nuts)m.raise.forEach(r=>{r.w*=.5;});    // mostly check-call a big hand
  }else if(type==='tag'){
    // Joe: opens 12.5BB, 25 / 37.5BB with good hands (25 / 50 / 75 at 1/2) and doubles a raise with a
    // decent hand; tighter and bigger, but never bluffing without a piece
    if(pre&&S.currentBet<=BB&&m.raise.length&&canR){
      const bbs=strength>=.66?(Math.random()<.5?25:37.5):12.5;
      m.raise=[{w:1,to:Math.round(BB*bbs)}];
    }else if(pre&&raises===2&&canR&&strength>=topT(.22)&&eq>odds){
      const to=S.currentBet*2;if(!m.raise.length)m.raise.push({w:1,to});else m.raise.forEach(r=>{r.w=Math.max(r.w,1);r.to=Math.max(r.to||0,to);});
    }
    m.raise.forEach(r=>{if(r.frac!=null&&r.frac<1&&eq>.6)r.frac=Math.min(1,r.frac*1.2);});
  }else if(type==='bluffer'){
    // Kmetsch: after a few real hands he runs a couple of bluffs — in spots where a bluff makes sense
    if(p.bluffing&&canR&&(c.opp||0)<=2&&!c.station&&!(pre&&S.currentBet>=BB*8)){
      const weak=pre?strength<.6:eq<.5;
      const to=raiseTo(c,pre?.8:.75);
      if(weak&&to<=p.bet+(p.stack+p.bet)*.4){
        if(!m.raise.length)bet(m,1,0,to);else m.raise.forEach(r=>{r.w=Math.max(r.w*2.5,1);});
        m.fold*=.3;
      }
    }
  }
  return m;
}

// ---- sample an action from the weights ----
function choose(m,c){
  const raises=c.canR?m.raise.filter(r=>r.w>0):[];
  const rw=raises.reduce((a,r)=>a+r.w,0);
  if(!c.toCall){
    // bet weights are probabilities of betting; the rest is a check
    if(rw>0&&Math.random()<Math.min(.95,rw)){const r=pickBy(raises,rw);return {type:'raise',to:raiseTo(c,r.frac,r.to)};}
    return {type:'check'};
  }
  // facing a bet: fold / call / raise, relative weights
  const total=m.fold+m.call+rw;if(total<=0)return {type:'fold'};
  let x=Math.random()*total;
  if((x-=m.fold)<0)return {type:'fold'};
  if((x-=m.call)<0)return {type:'call'};
  const r=pickBy(raises,rw);return {type:'raise',to:raiseTo(c,r.frac,r.to)};
}
function pickBy(list,total){let x=Math.random()*total;for(const r of list){if((x-=r.w)<0)return r;}return list[list.length-1];}

// Kmetsch's cycle: three real hands (betting or calling with a strong holding), then two bluffs
const REAL_HANDS=3,BLUFFS=2;
function bluffCycle(p,d,c){
  if((BOT_STYLE[p.name]||{}).type!=='bluffer')return;
  if(p.bluffing){
    if(d.type==='raise'){p.bl=(p.bl||0)+1;p.bluffs=(p.bluffs||0)+1;botSay(p,'bluff',.85);if(p.bl>=BLUFFS){p.bluffing=false;p.real=0;p.bl=0;}}
    return;
  }
  const real=c.pre?c.strength>.74:c.eq>.6;
  if(real&&(d.type==='raise'||d.type==='call'))p.real=(p.real||0)+1;
  if((p.real||0)>=REAL_HANDS)p.bluffing=true;
}
export function botDecide(p,i){
  const c=situation(p,i);
  CTX={pre:c.pre,strength:c.strength,eq:c.eq,toCall:c.toCall,pot:c.pot,canR:c.canR,position:c.position,street:c.street,raises:c.raises,checked:c.checked,opp:c.opp,station:c.station};
  const m=personality(c.pre?corePre(c):corePost(c),c);
  const d=choose(m,c);
  bluffCycle(p,d,c);
  if(d.type==='check')p.chk=S.hand+':'+S.board.length;   // remembered for a check-raise later this street
  if(globalThis.__botTrace)globalThis.__botTrace(p,d,CTX);  // tools/simulate.js --behaviour
  return d;
}
