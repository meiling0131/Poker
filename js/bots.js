// Bot strategy: one sound core, six personalities on top.
//
// The core plays the way solvers do, from public information only (its own cards, the board, what
// everyone has done this hand, and the table stats): opening ranges by position, 3-bets that are
// polarised (value plus suited blockers), calls by pot odds against the raiser's range, c-bets sized
// by texture, barrels and probes, bluffs in proportion to the bet size, and a defence that does not
// fold more than the minimum (pot ÷ (pot + bet)). Every opponent's range is modelled from their
// actions so far: an open-raiser is narrower than a limper, a 3-bettor narrower still, a player who
// bets every street has something. The core returns a distribution over the legal actions; the
// personality then bends those weights, each after a well-known player (Joe opens big and barrels, sc
// limps and never raises without the nuts, 奶龙 plays every hand and calls down, Kmetsch slow-plays and
// check-raises the river, ST traps and hero-calls, dwan barrels) but can only shift probability between
// options the core already allows at a reasonable price, so a bot keeps its character without giving its
// chips away: the bluffs they add stay out of crowds and away from calling stations.
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
  let pre=.18,post=0,preRaises=0,preCallLevel=0,big=0;
  for(const a of h){
    if(a.s!==0)continue;
    if(a.t==='raise'){preRaises++;big=Math.max(big,(a.b||0)/BB);}else if(a.t==='call')preCallLevel=Math.max(preCallLevel,a.r);
  }
  if(preRaises){
    pre=[0,.45,.62,.78,.88][Math.min(4,preRaises)]-(rd.af-.15)*1.2;
    if(big>4)pre+=Math.min(.22,(big-4)*.012);                  // the bigger the raise, the narrower
    if(big>=20&&rd.af<.1)pre=Math.max(pre,.86);                 // a jam from a player who rarely raises: premiums
  }
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
  const style=BOT_STYLE[p.id]||{loose:.5,aggr:.5},{loose,aggr,type}=style;
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
  return {p,i,hole,opponents,opp,loose,aggr,type,toCall,pot,odds,canR,position,inPos:position>=.6,last:position>=.99,
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
const chance=odds;   // the same, where `odds` is the price of a call
// the ace or king of a suit with three or more on the board, without the flush: a bluff that blocks the nuts
function blocker(hole,board){
  const n=[0,0,0,0];board.forEach(c=>n[suitOf(c)]++);
  return hole.some(c=>{const s=suitOf(c);return rankOf(c)>=13&&n[s]>=3&&n[s]+hole.filter(h=>suitOf(h)===s).length<5;});
}
function raiseTo(c,frac,to){
  const p=c.p;
  if(to==null)to=c.pre&&S.currentBet<=BB?BB*(2.5+(1-c.position)*.5)+c.limpers*BB:S.currentBet+Math.max(S.minRaise,(c.pot+c.toCall)*frac);
  to=Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),Math.round(to)));
  if(to>p.bet+p.stack*.85)to=maxRaiseTo(p);        // the last few chips go in with the raise
  return to;
}

function corePre(c){
  const m=mix(),{strength,position,raises,toCall,eq,depth,canR,suited,hi,lo,loose,aggr,commit,callers,limpers}=c;
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
  // a raise that would put most of the stack in is judged by equity against the raiser's range, not by a hand chart
  if(commit>.5&&!(eq>c.odds+.04))m.raise=[];
  if(!toCall){m.call=1;return m;}
  // calling: pot odds against the raiser's range, with position and suitedness helping play the hand
  const realization=.74+position*.13+(suited?.05:0);
  const margin=.02+(raises>=3?.06:0)-(loose-.5)*.03+(commit>.35?.05:0)+(S.currentBet>=BB*8?.05:0);
  const ok=eq*realization>c.odds+margin;
  m.call=ok?1:0;m.fold=ok?0:1;
  // the raise weights above are relative to a call: value raises dominate, bluffs are a share
  return m;
}

function corePost(c){
  const m=mix(),{eq,opp,toCall,pot,canR,inPos,last,river,street,pfr,ledLast,checked,tex,dr,station,commit,spr,aggr,loose,bettorRead}=c;
  const draw=dr.draw;
  // bluffs are rarer into calling stations and into a crowd
  const bluffy=(station?.15:1)*(opp>2?.5:1)*(river?1.25:1);
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
      const frac=station?(eq>.82?1:.8):size;
      if((pot+toCall)*frac>c.p.stack*.5&&eq<.64)w*=.25;
      bet(m,w,frac);
    }
    // flop c-bet by the preflop raiser: small and often on dry high boards, less on wet / low boards
    // and into more players; with air it is a bluff at the size's share
    if(street===3&&pfr&&canR&&opp<=3&&eq<=vT){
      const f=(tex.dryHigh?.82:tex.wet?.45:.65)*(opp===1?1:opp===2?.65:.4);
      bet(m,air?f*alpha(tex.dryHigh?.33:.6)*1.6*bluffy:f,tex.dryHigh?.33:.6);
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
      if(inPos&&eq>.46&&eq<=vT)bet(m,.7,.5);
      if(!inPos&&eq>.52&&eq<=vT)bet(m,.5,.4);                          // thin value from the front: small bet
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
  const maniac=bettorRead&&bettorRead.agg>.65&&bettorRead.af>.3;   // bets and raises everything: their raises mean little
  const margin=(river?-.01:.02)+(opp>2?.025:0)-(loose-.5)*.025+(commit>.35&&eq<.65?.05:0)
    +(passive?(street>=4?.07:.03):0)-(aggro?.05:0)+(spr<1.5&&eq>.5?-.03:0)+(raised?(maniac?.02:river?.1:.06):0);
  if(eq<c.odds+margin){
    m.fold=1;
    if(river&&canR&&opp===1&&last&&eq<.12)bet(m,odds(.04*aggr*bluffy),1);        // rare river bluff-raise
    return m;
  }
  m.call=1;
  // raise: strong hands (check-raise when I checked this street), strong draws at a good price
  const vR=raised&&!maniac?.88:opp===1?(maniac?.62:.72):.62;
  if(canR&&(eq>vR||(checked&&!raised&&eq>.7)))bet(m,odds((.5+aggr*.35)*(checked?1.25:1)*(raised?.8:1)),eq>.82?.9:.75);
  if(canR&&opp===1&&draw&&(dr.fd||dr.oesd)&&eq>.35&&toCall<pot*.4&&!river)bet(m,odds(aggr*.2*bluffy*(checked?1.5:1)),.65);
  return m;
}

// ---- personalities: bend the core's weights, never past a sound price ----
function personality(m,c){
  const {type,eq,toCall,pot,pre,strength,odds,raises,p,river,canR}=c;   // odds: the pot odds of the call
  if(type==='xuan'){
    // Joe (after Tan Xuan): loose and aggressive. Opens big — 12.5BB, 25 / 37.5BB with a good hand (25 /
    // 50 / 75 at 1/2) — steals from late position, never limps and doubles a raise; after the flop bets
    // more and bigger, keeps barrelling the hands he led with and wants the stacks in with a strong hand
    const bluffOK=!c.station&&c.opp<=2,small=to=>to<=p.bet+(p.stack+p.bet)*.4;
    if(pre){
      if(S.currentBet<=BB&&canR){
        const steal=c.position>=.6&&strength>=topT(.15+c.position*.35);
        if(m.raise.length||steal){
          const bbs=strength>=.66?(Math.random()<.5?25:37.5):12.5;
          m.raise=[{w:1,to:Math.round(BB*bbs+c.limpers*BB)}];m.fold*=.1;m.call*=.1;
        }
      }else if(raises===2&&canR&&eq>odds*.9&&(strength>=topT(.22)||(c.suited&&c.hi-c.lo<=2&&c.lo>=5))){
        const to=S.currentBet*2;
        if(!m.raise.length)m.raise.push({w:1,to});else m.raise.forEach(r=>{r.w=Math.max(r.w,1);r.to=Math.max(r.to||0,to);});
      }
      return m;
    }
    if(!toCall){
      m.raise.forEach(r=>{r.w*=1.3;if(r.frac!=null&&r.frac<1&&eq>.6)r.frac=Math.min(1.25,r.frac*1.3);});
      if(canR&&eq>.78&&c.spr<=2.5&&!river)bet(m,.6,0,maxRaiseTo(p));                         // a strong hand gets the stacks in
      if(canR&&bluffOK&&c.ledLast&&eq<.3&&small(raiseTo(c,river?1:.75)))bet(m,river?.3:.4,river?1:.75);   // the next barrel
      return m;
    }
    if(canR&&eq>.8)m.raise.forEach(r=>{r.w*=1.5;r.frac=Math.max(r.frac||0,.9);});
    if(canR&&!river&&bluffOK&&(c.dr.fd||c.dr.oesd))m.raise.forEach(r=>{r.w*=1.6;});        // draws raise
  }else if(type==='hellmuth'){
    // sc (after Phil Hellmuth): tight and passive. Limps and calls small raises to see the flop and raises
    // mostly with the best hands; after the flop lets go the moment the hand isn't good, never raises
    // without the nuts, bets small (under 25BB) when he bets at all, and folds a big river bet from a
    // player who rarely bets
    if(pre){
      if(strength<topT(.06)){
        if(S.currentBet<=BB&&toCall>0&&m.raise.length){m.call=2;m.fold=0;}                 // a limp, two times in three, instead of an open
        else m.raise.forEach(r=>{r.w*=.25;});                                              // and few raises over a limp or a raise
      }
      if(m.fold>0&&raises===2&&toCall<=BB*3&&strength>.5&&eq>odds*.8){m.call+=m.fold*.7;m.fold*=.3;}
      if(m.fold>0&&raises<=1&&toCall<=BB&&strength>.38){m.call+=m.fold*.6;m.fold*=.4;}       // a cheap look
      return m;
    }
    const nuts=eq>.93;
    m.raise.forEach(r=>{
      if(nuts)return;
      const to=r.to!=null?r.to:S.currentBet+Math.max(S.minRaise,(pot+toCall)*(r.frac||.5));
      if(to<BB*25&&!toCall)r.w*=.6;else r.w*=0;            // small bets only when nobody has bet
    });
    if(eq>.75&&!nuts)m.raise.forEach(r=>{r.w*=.5;});        // mostly check-call a big hand
    if(river&&toCall&&m.call>0&&c.bettorRead&&c.bettorRead.agg<.3&&toCall>=(pot-toCall)*.7&&eq<.75){m.fold+=m.call*.5;m.call*=.5;}   // the big laydown
  }else if(type==='keating'){
    // 奶龙 (after Alan Keating): plays almost every hand and loves to raise it; sticky after the flop, calls
    // the river down with a pair and now and then overbets it with nothing. Big bets without a hand are
    // still folded
    const cheap=pre?toCall<=BB*6:toCall<=Math.min(pot*.4,(p.stack+p.bet)*.12)&&raises<2;
    const close=pre?strength>.3:eq>odds-.08&&!(river&&c.made<1&&eq<.5);
    if(m.fold>0&&cheap&&close){m.call+=m.fold*.6;m.fold*=.4;}
    if(m.fold>0&&pre&&toCall<=BB&&strength>.15){m.call+=m.fold*.85;m.fold*=.15;}
    if(pre&&canR&&!m.raise.length){
      if(S.currentBet<=BB&&strength>=topT(.45))bet(m,.6,0);                                    // raises a wide range first in
      else if(raises===2&&strength>=topT(.25)&&S.currentBet<BB*8)bet(m,chance(.2),0,S.currentBet*3);   // and 3-bets light
    }
    if(m.fold>0&&river&&c.opp===1&&c.made>=1&&eq>odds-.1&&toCall>=(pot-toCall)*.5){m.call+=m.fold*.4;m.fold*=.6;}   // the hero call
    if(!pre&&!toCall&&river&&canR&&eq<.25&&c.opp===1&&!c.station&&raiseTo(c,1.2)<=p.bet+(p.stack+p.bet)*.45)bet(m,.12,1.2);   // an overbet bluff
  }else if(type==='dwan'){
    // dwan (after Tom "durrrr" Dwan): plays many hands and 3-bets light, floats in position, keeps
    // barrelling, overbets the nuts and bluffs the river with a blocker; calls down lighter against
    // players who bet a lot
    const bluffOK=!c.station&&c.opp<=2,small=to=>to<=p.bet+(p.stack+p.bet)*.35;
    if(pre){
      if(S.currentBet<=BB&&canR&&!m.raise.length&&strength>=topT(Math.min(.7,.18+c.position*.38))){bet(m,1,0);m.fold*=.1;m.call*=.1;}
      if(raises===2&&canR){
        const light=(c.suited&&(c.hi>=13||(c.hi-c.lo<=2&&c.lo>=4)))||(c.inPos&&c.lo>=10);
        const to=S.currentBet*(c.inPos?3:3.6)+c.callers*S.currentBet;
        if(light&&!m.raise.length&&S.currentBet<BB*8&&small(to))bet(m,chance(c.inPos?.38:.22),0,to);
        // and calls more opens in position with hands that play well after the flop
        if(m.fold>0&&c.inPos&&toCall<=BB*5&&strength>.3&&(c.suited||c.hi===c.lo||c.hi-c.lo<=1)){m.call+=m.fold*.7;m.fold*=.3;}
      }
      if(raises===3&&canR&&!m.raise.length&&c.suited&&c.hi===14&&c.lo<=5&&small(S.currentBet*2.3))bet(m,chance(.18),0,S.currentBet*2.3);   // a 4-bet bluff with the ace
      return m;
    }
    if(!toCall){
      m.raise.forEach(r=>{r.w*=1.4;});
      if(canR&&bluffOK&&!m.raise.length&&!river)bet(m,.3,.6);                     // a stab when nothing else bets
      if(river&&canR){
        if(eq>.86)bet(m,.55,1.5);                                                  // the nuts: overbet
        else if(eq<.3&&bluffOK&&(c.ledLast||blocker(c.hole,S.board))&&small(raiseTo(c,1.25)))bet(m,.35,1.25);   // the third barrel
      }
      return m;
    }
    if(canR&&c.dr.draw&&!river&&c.opp===1)m.raise.forEach(r=>{r.w*=2;});           // draws raise
    if(m.fold>0&&c.street===3&&c.inPos&&c.opp===1&&toCall<=(pot-toCall)*.75&&eq>.18){m.call+=m.fold*.4;m.fold*=.6;}   // a float, to take it later
    if(m.fold>0&&river&&c.opp===1&&c.bettorRead&&c.bettorRead.agg>.35&&eq>odds-.07){m.call+=m.fold*.6;m.fold*=.4;}  // picks off a bettor's bluffs
  }else if(type==='st'){
    // ST (after the high-stakes regular Zuo "ST" Wang): limps some hands, now and then a monster to
    // limp-reraise, opens big and at any size with the rest; traps strong hands to check-raise (all in on
    // the flop when the stacks are short to the pot) and calls big river bets down with a pair
    if(pre){
      const limped=(p.hist||[]).some(a=>a.s===0&&a.t==='call'&&a.r<=1),monster=strength>=topT(.035);
      const speculative=(c.hi===c.lo&&c.hi<=9)||(c.suited&&c.hi-c.lo<=2&&c.hi<=11);
      if(S.currentBet<=BB&&canR&&toCall>0){
        if(monster&&c.position<.7&&Math.random()<.3){m.raise=[];m.call=1;m.fold=0;return m;}
        if(m.raise.length&&speculative&&Math.random()<.5){m.raise=[];m.call=1;m.fold=0;return m;}
        if(!m.raise.length&&speculative&&toCall<=BB){m.call+=m.fold*.6;m.fold*=.4;}
      }
      if(S.currentBet<=BB)m.raise.forEach(r=>{if(r.to==null)r.to=Math.round(BB*(monster?4+Math.random()*2:2.2+Math.random()*2.8)+c.limpers*BB);});
      if(limped&&raises===2&&canR&&strength>=topT(.05)){m.raise=[{w:chance(.9),to:c.depth<=40?maxRaiseTo(p):S.currentBet*4}];m.fold=0;}
      else if(raises>=2&&m.fold>0&&c.hi===c.lo&&toCall<=(p.stack+p.bet)*.08){m.call+=m.fold*.7;m.fold*=.3;}   // a pair calls a raise: a set wins a big pot
      return m;
    }
    if(!toCall){
      if(!c.inPos&&eq>.72&&!river&&c.opp>=1)m.raise.forEach(r=>{r.w*=.45;});      // check a strong hand, to check-raise
      m.raise.forEach(r=>{if(r.frac!=null&&r.to==null)r.frac*=.6+Math.random()*.9;});   // sizes that are hard to read
      if(river&&canR&&eq<.25&&c.opp===1&&!c.station&&raiseTo(c,1.4)<=p.bet+(p.stack+p.bet)*.5)bet(m,.12,1.4);   // now and then a big river bluff
      return m;
    }
    if(c.checked&&canR&&!river&&(eq>.74||((c.dr.fd||c.dr.oesd)&&eq>.38))){
      if(c.street===3&&c.spr<=4)m.raise=[{w:chance(.7),to:maxRaiseTo(p)}];else m.raise.forEach(r=>{r.w*=1.6;});
    }
    if(m.fold>0&&river&&c.opp===1&&toCall>=(pot-toCall)*.6&&eq>odds-.08&&c.made>=1){m.call+=m.fold*.7;m.fold*=.3;}   // the hero call
  }else if(type==='wangye'){
    // Kmetsch (after 王烨 Wang Ye): solid before the flop. A big hand is slow-played — called on the flop and
    // turn, then check-raised on the river, all in when the stack is not much more than the pot; after a few
    // real hands he runs the same line as a bluff, once or twice, heads up and never into a calling station
    if(pre)return m;
    const heads=c.opp===1&&!c.station;
    const big=(p.stack+p.bet)<=(pot+toCall)*2.5?maxRaiseTo(p):raiseTo(c,1.2);
    if(!river&&eq>.82)m.raise.forEach(r=>{r.w*=toCall?.35:c.inPos?.6:.3;});                  // slow-play
    if(river&&!toCall&&!c.inPos&&eq>.85&&heads)m.raise.forEach(r=>{r.w*=.45;});              // check, to raise
    if(river&&toCall&&c.checked&&canR&&eq>.85)m.raise=[{w:chance(.85),to:big}];              // the check-raise
    if(p.bluffing&&heads){
      if(toCall&&!river&&m.fold>0&&eq>.18&&toCall<=(pot-toCall)*.75){m.call+=m.fold*.6;m.fold*=.4;}   // calls along
      if(river&&canR&&eq<.3){if(!toCall)bet(m,c.inPos?.7:.25,0,big);else if(c.checked)m.raise=[{w:chance(.5),to:big}];}
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

// Kmetsch's cycle: three real hands (betting or calling with a strong holding), then up to two bluffs; a
// bluff needs the right spot (heads up, on the river), so the bluffing mood lasts a few hands at most
const REAL_HANDS=3,BLUFFS=2,BLUFF_HANDS=8;
function bluffCycle(p,d,c){
  if((BOT_STYLE[p.id]||{}).type!=='wangye')return;
  if(p.bluffing){
    if(d.type==='raise'&&!c.pre&&c.eq<.3){p.bl=(p.bl||0)+1;p.bluffs=(p.bluffs||0)+1;botSay(p,'bluff',.85);}
    if((p.bl||0)>=BLUFFS||S.hand-(p.bh||0)>=BLUFF_HANDS){p.bluffing=false;p.real=0;p.bl=0;}
    return;
  }
  const real=c.pre?c.strength>.74:c.eq>.6;
  if(real&&(d.type==='raise'||d.type==='call'))p.real=(p.real||0)+1;
  if((p.real||0)>=REAL_HANDS){p.bluffing=true;p.bh=S.hand;}
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
