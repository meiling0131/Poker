// Table talk: avatars, bot banter, emoji reactions.
import {commit} from './online.js';
import {M,MYDOC,S,myRef,setFLASH,view} from './state.js';
import {later,mySeat} from './table.js';

export const BOT_AV={Joe:'🐯',sc:'🐰',老周:'🐢',奶龙:'🐲',Kmetsch:'🐻',阿芳:'🐱'};
export const HUMAN_AV=['🐼','🐨','🐸','🐵','🐧','🦁','🐷','🐮','🐔','🦄','🐙','🦉','🐶','🐹'];
export function avatarOf(p){
  if(p.kind==='bot')return BOT_AV[p.name]||'🤖';
  let h=0;for(const c of String(p.uid))h=(h*31+c.charCodeAt(0))>>>0;
  return HUMAN_AV[h%HUMAN_AV.length];
}
export const LINES={
  fold:['这牌我都不好意思看','溜了溜了','你们玩，我看戏','手气留给下一把','打扰了','算你狠'],
  check:['过～','我先看看','让一让','稳住'],
  call:['跟就跟，谁怕谁','我就看一眼','不信你有','来都来了','我是来交朋友的'],
  raise:['加点料','你敢跟吗？','我牌很大（真的）','今天手热','不服来战'],
  allin:['梭哈！','全部家当都在这了','不装了，摊牌了','要么吃肉要么回家','信我一次'],
  win:['谢谢老板','承让承让','这就是实力','晚饭有着落了','运气也是实力'],
  bust:['我的筹码…','重来重来','今天不宜打牌','我去充个值','这不科学'],
  reply:['😂','🙄','你别得意','🐟','👍','😏','就这？','下把见真章']
};
// lines that only one bot says (fall back to LINES)
export const PERSONA_LINES={
  奶龙:{call:['跟！钱不是问题','我就喜欢看牌','来都来了，跟','小钱，跟'],check:['看看再说','先看牌'],raise:['我说白了'],
    win:['有钱就是任性','早说了我运气好'],bust:['没事，我家有矿'],rebuy:['再来两手！我有的是钱','充值成功，继续','买两手，接着奏乐接着舞']},
  Joe:{fold:['这牌不打','纪律第一','等好牌'],allin:['这手我很有把握'],
    win:['按计划来','耐心是有回报的'],call:['合理的价格，跟'],raise:['加倍！','翻前就是要加倍','牌好，下大注','不让你便宜看牌']},
  sc:{fold:['其实我能赢'],call:['看看','先看一张'],check:['看牌'],raise:['加一点点','小加一手']},
  Kmetsch:{raise:['这把是真的','我有牌'],call:['跟一下'],bluff:['信我，我有','这把我认真的','你敢跟吗？','我从不诈唬'],
    win:['我说了我有','嘿嘿'],fold:['这次算你赢']},
};
// a bot that always says its line for a given action
export const PERSONA_ALWAYS={奶龙:{raise:1},sc:{fold:1}};
export const EMOJIS=['😂','👍','😭','😡','🤔','🔥','🙏','🤡','💸','🐟'];
export function say(p,t,ms=3600){p.say={t:String(t).slice(0,24),until:Date.now()+ms};}
export function botSay(p,kind,prob){
  const L=(PERSONA_LINES[p&&p.name]||{})[kind]||LINES[kind];
  const always=!!(PERSONA_ALWAYS[p&&p.name]||{})[kind];
  if(!p||p.kind!=='bot'||S.mode!=='bots'||!L||(!always&&Math.random()>prob))return;
  const big=kind==='win'||kind==='bust'||kind==='rebuy';
  if(!always&&!big&&p.say&&p.say.until>Date.now())return;
  // small talk: one bot at a time
  if(!always&&!big&&S.seats.some(q=>q!==p&&q.say&&q.say.until>Date.now()))return;
  say(p,L[Math.floor(Math.random()*L.length)]);
}
export let EMO_OPEN=false,EMO_LAST=0,EMO_N=0;
export async function sendEmoji(e){
  const m=mySeat();if(m<0||!EMOJIS.includes(e)||Date.now()-EMO_LAST<1500)return;
  EMO_LAST=Date.now();EMO_OPEN=false;
  const p=S.seats[m];
  if(M.host){
    say(p,e);commit();
    if(S.mode==='bots'&&Math.random()<.45){
      const pool=S.seats.filter(q=>q.kind==='bot'&&q.stack+q.total>0);const b=pool[Math.floor(Math.random()*pool.length)];
      if(b)later(()=>{botSay(b,'reply',1);commit();},700+Math.random()*900);
    }
    return;
  }
  EMO_N=Math.max(EMO_N,Number((MYDOC&&MYDOC.emo&&MYDOC.emo.n)||0))+1;
  say(p,e);view.renderHero(); // shown at once here; the host relays it to everyone else
  try{await myRef.update({emo:{e,n:EMO_N}});}catch(err){setFLASH('表情发送失败');view.render();}
}
// host: pick up emoji a player sent through their own seat doc
export function syncEmoji(p,d){
  const n=Number(d&&d.emo&&d.emo.n)||0;
  if(!(n>(p.emoN||0)))return false;
  p.emoN=n;if(EMOJIS.includes(d.emo.e))say(p,d.emo.e);return true;
}
export function setEMO_OPEN(v){EMO_OPEN=v;}
