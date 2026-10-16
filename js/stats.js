// 我的统计: per-player hand statistics.
import {S} from './state.js';
import {bookKey} from './table.js';
import {store} from './util.js';

// per player (book key): h 手数, vp 入池, pr 翻前加注, w 赢的手数, sd 摊牌, sdw 摊牌赢, big 最大赢得底池
export const ZS=()=>({h:0,vp:0,pr:0,w:0,sd:0,sdw:0,big:0,pa:0,pb:0});
export function loadMyStats(){try{const v=JSON.parse(store.get('poker.stats.bots')||'null');return v&&typeof v.h==='number'?Object.assign(ZS(),v):null;}catch(e){return null;}}
export function recordStats(){
  S.stats=S.stats||{};
  S.seats.forEach(p=>{
    if(!p.inHand)return;
    const k=bookKey(p),st=S.stats[k]=Object.assign(ZS(),S.stats[k]);
    st.h++;if(p.vp)st.vp++;if(p.pr)st.pr++;st.pa+=p.pa||0;st.pb+=p.pb||0;   // pa/pb: actions and bets or raises after the flop
    if(p.win){st.w++;st.big=Math.max(st.big,p.won||0);}
    if(p.shown&&!p.folded){st.sd++;if(p.win)st.sdw++;}
  });
  // the same counts the database keeps (games/stats), for a player's card at the table: a practice table has
  // no database, so its cards read these. The biggest win keeps the earlier hand on a tie.
  for(const r of handRows(S)){
    const st=S.stats[r.player_id];if(!st)continue;
    st.hands=(st.hands||0)+1;st.hands_won=(st.hands_won||0)+r.won;
    for(const c of ['vpip','pfr','ats','ats_opp','3bet','saw_flop','wtsd','wsd','wwsf'])st[c]=(st[c]||0)+r[c];
    if(r.won_amount>(st.biggest_win_amount||0)){st.biggest_win_amount=r.won_amount;st.biggest_win_hand=r.won_hand;}
  }
  // 人机模式里你的统计存在本机，换桌、刷新都会累计
  if(S.mode==='bots'&&S.stats.local)store.set('poker.stats.bots',JSON.stringify(S.stats.local));
}
export const pct=(a,b)=>b?Math.round(a*100/b)+'%':'—';
// One games row per seat dealt into the hand that just finished (the games table in DATABASE.md).
// Bots are recorded under their bot id, people under their uid. Counts are 0 or 1.
export function handRows(T){
  const flop=T.board.length>=3,b=v=>v?1:0;
  return T.seats.filter(p=>p.inHand).map(p=>{
    const fold=(p.hist||[]).find(h=>h.t==='fold'),saw=flop&&!(fold&&fold.s<3),pots=p.pots||[];
    return {player_id:bookKey(p),mode:T.mode==='online'?'online':'regular',
      won:b(pots.length),won_chop:b(p.chop),won_amount:p.gw||0,won_pot:JSON.stringify(pots),won_hand:p.wh||'',
      vpip:b(p.vp),pfr:b(p.pr),ats:b(p.st),ats_opp:b(p.so),'3bet':b(p.tb),saw_flop:b(saw),
      wtsd:b(p.sd),wsd:b(p.sd&&pots.length),wwsf:b(saw&&pots.length)};
  });
}
