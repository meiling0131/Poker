// Delegated DOM event handlers.
import {BET_MENU,actionLabels,cancelAction,commitAllIn,confirmAction,money,openBetMenu,pendingIsCurrent,requestAction,setPre,stillMyTurn,tidy,vote} from '../actions.js';
import {Z,pickChips} from '../chips.js';
import {maybeStart,newBotsTable,newOnlineTable,startHand} from '../engine.js';
import {SOUND,beep,setSOUND} from '../fx.js';
import {enterBots,enterOnline,toMenu} from '../modes.js';
import {approveBuy,commit,joinTable,kick,leaveTable,newRoomCode,normRoom,roomLink,unkick} from '../online.js';
import {SHOW_HAND,readStakeForm,setSHOW_HAND,setSkin} from '../settings.js';
import {CONFIRM_RESET,GEN,M,PUSH,S,TT,setCONFIRM_RESET,setFLASH,setGEN,setPUSH,setSPEED,setVIEW} from '../state.js';
import {log,maxRaiseTo,minRaiseTo,mySeat,myTurn,potTotal} from '../table.js';
import {EMO_OPEN,sendEmoji,setEMO_OPEN} from '../talk.js';
import {renderHero} from './hero-view.js';
import {renderMenu} from './menu-view.js';
import {render} from './render.js';
import {$,store} from '../util.js';

document.addEventListener('change',e=>{
  if(e.target.id==='soundOn'){setSOUND(e.target.checked);store.set('poker.sound',SOUND?'on':'off');if(SOUND)beep();return;}
  if(e.target.id==='handHints'||e.target.dataset.handHints){
    setSHOW_HAND(e.target.checked);store.set('poker.showHand',SHOW_HAND?'on':'off');
    $('handHints').checked=SHOW_HAND;if(S)renderHero();
  }
});
document.addEventListener('click',e=>{
  const mo=$('more');if(mo&&!mo.hidden&&!e.target.closest('.morewrap'))mo.hidden=true;
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.mode){if(readStakeForm())enterBots(t.dataset.mode);return;}
  if(t.dataset.room){
    const nick=($('nick')&&$('nick').value||'').replace(/\s+/g,' ').trim().slice(0,16);
    if(!nick){setFLASH('先填一个昵称');renderMenu();$('nick')&&$('nick').focus();return;}
    M.nick=nick;store.set('poker.nick',nick);setFLASH('');
    if(t.dataset.room==='create'){if(!readStakeForm())return;enterOnline(newRoomCode(),true);return;}
    const code=normRoom($('roomIn')&&$('roomIn').value);
    if(!code){setFLASH('填一下房间号，或者新开一个房间');renderMenu();return;}
    enterOnline(code,false);return;
  }
  if(t.dataset.copy){
    const txt=roomLink();
    const done=()=>{t.textContent='已复制';setTimeout(()=>{t.textContent='复制链接';},1500);};
    try{navigator.clipboard.writeText(txt).then(done,()=>{const el=$('linktxt');if(el){const r=document.createRange();r.selectNodeContents(el);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);}});}catch(e){}
    return;
  }
  if(t.id==='moreBtn'){const m=$('more');m.hidden=!m.hidden;t.setAttribute('aria-expanded',String(!m.hidden));return;}
  if(t.id==='menuBtn'){$('more').hidden=true;toMenu();return;}
  if(t.dataset.view){setVIEW(t.dataset.view);render();window.scrollTo&&window.scrollTo(0,0);return;}
  if(t.dataset.skin){setSkin(t.dataset.skin);return;}
  if(t.dataset.speed){setSPEED(+t.dataset.speed);document.querySelectorAll('#speed button').forEach(b=>b.classList.toggle('on',b===t));return;}
  if(t.id==='restart'){
    if(!M.host||!S)return;
    if(!CONFIRM_RESET){setCONFIRM_RESET(true);render();setTimeout(()=>{setCONFIRM_RESET(false);if(M.mode)render();},4000);return;}
    setCONFIRM_RESET(false);setGEN(GEN+1);clearTimeout(TT);
    if(S.mode==='bots')newBotsTable();else newOnlineTable(true);
    log('牌桌已重置，账本清零，所有人筹码回到 0','h');commit();maybeStart();return;
  }
  if(t.dataset.m){money(t.dataset.m);return;}
  if(t.dataset.tidy){tidy();return;}
  if(t.dataset.pre){setPre(t.dataset.pre);return;}
  if(t.dataset.statsReset){if(t.dataset.sure){store.set('poker.stats.bots','');if(S&&S.stats)delete S.stats.local;render();}else{t.dataset.sure='1';t.textContent='确认清空？';}return;}
  if(t.dataset.emoOpen){setEMO_OPEN(!EMO_OPEN);renderHero();return;}
  if(t.dataset.emo){sendEmoji(t.dataset.emo);return;}
  if(t.dataset.approve){approveBuy(t.dataset.approve,true);return;}
  if(t.dataset.deny){approveBuy(t.dataset.deny,false);return;}
  if(t.dataset.kick){kick(t.dataset.kick);return;}
  if(t.dataset.unkick){unkick(t.dataset.unkick);return;}
  const a=t.dataset.a;
  if(a==='next'){if(M.host&&S.street==='done')startHand();return;}
  if(a==='join'){joinTable();return;}
  if(a==='leave'){leaveTable();return;}
  if(t.dataset.vote){vote(Number(t.dataset.vote));return;}
  if(!myTurn()){return;}
  const p=S.seats[mySeat()];
  if(a==='cancel'){cancelAction();renderHero();return;}
  if(a==='confirm'){confirmAction();return;}
  if(t.dataset.preset){
    if(t.dataset.preset==='custom')requestAction('raise',minRaiseTo(p),null,true);
    else requestAction('raise',Number(t.dataset.preset));
    return;
  }
  if(pendingIsCurrent()||stillMyTurn(BET_MENU))cancelAction();
  if(t.dataset.push){const d=Number(t.dataset.push);if(PUSH[d]<p.chips[d]){PUSH[d]++;renderHero();}return;}
  if(t.dataset.pull){const d=Number(t.dataset.pull);if(PUSH[d]>0){PUSH[d]--;renderHero();}return;}
  if(t.dataset.clear){setPUSH(Z());renderHero();return;}
  if(t.dataset.fill){
    const toCall=Math.max(0,S.currentBet-p.bet),pot=potTotal(),f=t.dataset.fill;
    const target={min:minRaiseTo(p),half:S.currentBet+Math.round((pot+toCall)*0.5),pot:S.currentBet+pot+toCall}[f];
    if(f==='all')setPUSH(Object.assign(Z(),p.chips));
    else{const tgt=Math.max(minRaiseTo(p),Math.min(maxRaiseTo(p),target));setPUSH(pickChips(p.chips,tgt-p.bet));}
    renderHero();return;
  }
  if(a==='allin'){commitAllIn(p);return;}
  if(a==='fold'){requestAction('fold');return;}
  if(a==='call'){
    const L=actionLabels(p);
    const picked=L.pushed>=L.toCall&&L.toCall>0&&(L.callChange||L.pushed===L.toCall)?Object.assign({},PUSH):null;
    requestAction(L.toCall===0?'check':'call',0,picked);return;
  }
  if(a==='raise'){
    const L=actionLabels(p);if(!L.raise)return;
    if(L.raise.mode==='fill'){openBetMenu();return;}
    if(L.raise.mode==='go')requestAction('raise',L.allIn?p.bet+p.stack:L.to,Object.assign({},PUSH));
    return;
  }
});
