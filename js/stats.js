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
  // 人机模式里你的统计存在本机，换桌、刷新都会累计
  if(S.mode==='bots'&&S.stats.local)store.set('poker.stats.bots',JSON.stringify(S.stats.local));
}
export const pct=(a,b)=>b?Math.round(a*100/b)+'%':'—';
