// Table talk: avatars, bot banter, emoji reactions.
import {commit} from './online.js';
import {M,MYDOC,S,myRef,setFLASH,view} from './state.js';
import {later,mySeat} from './table.js';

export const BOT_AV={阿杰:'🐯',小雨:'🐰',老周:'🐢',Mia:'🦊',大卫:'🐻',阿芳:'🐱'};
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
export const EMOJIS=['😂','👍','😭','😡','🤔','🔥','🙏','🤡','💸','🐟'];
export function say(p,t,ms=3600){p.say={t:String(t).slice(0,24),until:Date.now()+ms};}
export function botSay(p,kind,prob){
  if(!p||p.kind!=='bot'||S.mode!=='bots'||!LINES[kind]||Math.random()>prob)return;
  if(p.say&&p.say.until>Date.now()&&kind!=='win'&&kind!=='bust')return;
  const L=LINES[kind];say(p,L[Math.floor(Math.random()*L.length)]);
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
