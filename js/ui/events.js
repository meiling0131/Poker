// Delegated DOM event handlers.
import {BET_MENU,cancelAction,commitAllIn,commitRaise,confirmAction,money,openBetMenu,pendingIsCurrent,placeBet,requestAction,selectCall,setPre,setRaiseAt,stillMyTurn,tidy,toggleAutoTidy,vote} from '../actions.js';
import {Z,pickChips} from '../chips.js';
import {startHand} from '../engine.js';
import {SOUND,beep,setSOUND} from '../fx.js';
import {enterBots,enterOnline,exitTable} from '../modes.js';
import {approveBuy,joinTable,kick,leaveTable,newRoomCode,normRoom,roomLink,unkick} from '../online.js';
import {SHOW_HAND,SKIN,PRESET,PRESETS,applyPreset,readStakeForm,setSHOW_HAND,setSkin} from '../settings.js';
import {LOBBY,M,PROFILE,PUSH,S,SPEED,setFLASH,setPROFILE,setPUSH,setSPEED,setVIEW} from '../state.js';
import {bookKey,lockedIn,maxRaiseTo,minRaiseTo,mySeat,myTurn,potTotal} from '../table.js';
import {EMO_OPEN,sendEmoji,setEMO_OPEN} from '../talk.js';
import {confirmMoney,renderHero,toggleBuy} from './hero-view.js';
import {nameNext,openFriends,renderMenu,renderRooms,setNameAsk,setNameNext,setNamePopup,setSettingsDraft,setStats,settingsDraft,shownBalance} from './menu-view.js';
import {dismissOvertime,render} from './render.js';
import {cleanPlayerName,displayName,fetchSeatStats,fetchStats,restrictNameInput,savePlayer} from '../player.js';
import {$,store} from '../util.js';
import {profileLive,renderTable,setProfileData,setProfileView} from './table-view.js';
import {serverCmd} from '../net.js';
import {LANG,setLang,tr} from '../i18n.js';

let NAME_SAVING=false;
function nameError(msg){const el=$('nameErr');if(el)el.textContent=msg;}
function nameFail(got){
  const err=got&&got.error;
  nameError(err==='once'?tr('名字只能修改一次'):err==='name'?tr('名字不能以 # 或🤖开头'):err==='closing'?tr('正在清理牌桌，请于 12:00AM 后再留名。'):tr('没能保存，请再试一次。'));
}
async function writeName(name){
  if(NAME_SAVING)return {error:'save'};
  const uid=M.uid,token=store.get('poker.token');
  if(!uid||!token)return {error:'save'};
  NAME_SAVING=true;
  let got;
  try{got=await savePlayer(uid,token,name);}catch(e){got=null;}
  NAME_SAVING=false;
  if(!got||got.error)return got||{error:'save'};
  M.player=got.player;M.nick=displayName(got.player.name);store.set('poker.nick',M.nick);
  return got;
}
async function submitName(){
  if(NAME_SAVING)return;
  if(M.player&&String(M.player.name||'').trim().startsWith('#'))return;
  const input=$('nameIn');
  const name=cleanPlayerName(input&&input.value);
  if(input&&input.value!==name)input.value=name;
  if(!name){nameError(tr('请填写名字'));return;}
  if(name.startsWith('#')){nameError(tr('名字不能以 # 或🤖开头'));return;}
  if(M.player){setNameNext(name);setNameAsk('rename');renderMenu();return;}
  const got=await writeName(name);
  if(!got||got.error){nameFail(got);return;}
  if(got.created)location.reload();
}
async function confirmRename(){
  const got=await writeName(nameNext());
  if(!got||got.error){setNameAsk('');renderMenu();nameFail(got);return;}
  setNameAsk('stats');renderMenu();   // back to 查看数据, under the new name
}
// a player's card at the table: today's stats from the database on a real table, fetched each time it opens
async function openProfile(key){
  setPROFILE(key);setProfileView('');setProfileData(key,undefined);renderTable();
  if(!profileLive())return;
  let got;
  try{got=await fetchSeatStats(key);}catch(err){got='error';}
  setProfileData(key,got);
  if(PROFILE===key)renderTable();
}
function applySettings(){
  const d=settingsDraft();
  if(d.sound!==SOUND){setSOUND(d.sound);store.set('poker.sfx',SOUND?'on':'off');if(SOUND)beep();}
  setSPEED(d.speed);store.set('poker.speed',String(d.speed));
  setSkin(d.skin);
  const lang=d.lang!==LANG;if(lang)setLang(d.lang);
  setNamePopup(false);if(lang)render();else renderMenu();
}
// 查看数据: fetched each time it opens, so it is today's numbers as of the last hand
async function openStats(){
  setNameAsk('stats');setStats(undefined);renderMenu();
  let got;
  try{got=await fetchStats(M.uid,store.get('poker.token'));}catch(err){got='error';}
  setStats(got);
  if($('usernamePopup'))renderMenu();
}
function forgetBrowser(){
  try{localStorage.removeItem('poker.uid');localStorage.removeItem('poker.token');}catch(e){}
  location.reload();
}
document.addEventListener('input',e=>{
  if(e.target.id!=='nameIn')return;
  const prev=e.target.value,next=restrictNameInput(prev);
  if(next===prev)return;
  const at=e.target.selectionStart||0;
  e.target.value=next;
  const pos=Math.max(0,at-(prev.length-next.length));
  try{e.target.setSelectionRange(pos,pos);}catch(err){}
});
document.addEventListener('change',e=>{
  if(e.target.id==='handHints'||e.target.dataset.handHints){
    setSHOW_HAND(e.target.checked);store.set('poker.showHand',SHOW_HAND?'on':'off');
    if(S)renderHero();
  }
});
// Enter in the room boxes does what the button next to them does
document.addEventListener('keydown',e=>{
  if(e.key!=='Enter'||e.isComposing)return;
  const id=e.target.id;
  const b=id==='nameIn'?document.querySelector('[data-name="ok"]'):id==='roomIn'?document.querySelector('[data-room="join"]'):id==='rjPw'?document.querySelector('[data-enter-room]'):id==='cpPw'?document.querySelector('[data-confirm-create]'):null;
  if(b){e.preventDefault();b.click();}
});
document.addEventListener('click',e=>{
  const seatEl=e.target.closest('[data-seat]');
  if(seatEl&&S){const q=S.seats[Number(seatEl.dataset.seat)];if(q)openProfile(bookKey(q));return;}
  if(PROFILE&&!e.target.closest('.seatcard')){setPROFILE(null);if(S)renderTable();}
  const t=e.target.closest('button');if(!t)return;
  // 设置: a draft of the current settings; 确认 applies it, 取消 drops it
  if(t.dataset.settings!=null){setSettingsDraft({sound:SOUND,speed:SPEED,skin:SKIN,lang:LANG});setNamePopup(true);setNameAsk('settings');renderMenu();return;}
  if(t.dataset.setLang){setSettingsDraft({lang:t.dataset.setLang});renderMenu();return;}
  if(t.dataset.setSound){setSettingsDraft({sound:t.dataset.setSound==='1'});renderMenu();return;}
  if(t.dataset.setSpeed){setSettingsDraft({speed:+t.dataset.setSpeed});renderMenu();return;}
  if(t.dataset.setSkin){setSettingsDraft({skin:t.dataset.setSkin});renderMenu();return;}
  if(t.dataset.about!=null){setNamePopup(true);setNameAsk('about');renderMenu();return;}
  if(t.dataset.langPick){setLang(t.dataset.langPick);$('langPopup').hidden=true;render();return;}
  // the name pill: no name yet asks for one; with a name it opens the menu (查看数据, 修改名字, 清除账号, 返回)
  if(t.dataset.greet!=null){setNamePopup(true);if(M.player){openStats();return;}setNameAsk('');renderMenu();$('nameIn')&&$('nameIn').focus();return;}
  if(t.dataset.name){
    if(t.disabled)return;
    if(t.dataset.name==='ok')submitName();
    else if(t.dataset.name==='rename-ok')confirmRename();
    else if(t.dataset.name==='clear'){setNameAsk('clear');renderMenu();}
    else if(t.dataset.name==='clear-ok')forgetBrowser();
    else if(t.dataset.name==='ask-no'||t.dataset.name==='edit'){setNameAsk('');renderMenu();$('nameIn')&&$('nameIn').focus();}
    else if(t.dataset.name==='stats-back'){setNameAsk('stats');renderMenu();}
    else if(t.dataset.name==='settings'){setNameAsk('settings');renderMenu();}
    else if(t.dataset.name==='settings-ok')applySettings();
    else if(t.dataset.name==='stats')openStats();
    else if(t.dataset.name.startsWith('stat:')){setNameAsk(t.dataset.name);renderMenu();}
    else if(t.dataset.name==='dismiss'){setNamePopup(false);setFLASH('');renderMenu();}
    return;
  }
  if(t.dataset.profileClose){setPROFILE(null);renderTable();return;}
  if(t.dataset.pstat!=null){setProfileView(t.dataset.pstat);renderTable();return;}
  if(t.dataset.stake!=null){if(t.disabled||!M.player||PRESETS[+t.dataset.stake].buy>shownBalance())return;applyPreset(+t.dataset.stake);renderMenu();return;}
  if(t.dataset.mode){if(t.disabled||(t.dataset.mode!=='practice'&&!M.player))return;if(PRESETS[PRESET].buy>shownBalance())return;if(readStakeForm())enterBots(t.dataset.mode);return;}
  // 好友模式: you play under your own name, so a room needs only its code (and a password if it has one)
  if(t.dataset.friends!=null){if(t.disabled||!M.player)return;setFLASH('');openFriends();return;}
  if(t.dataset.room){
    if(!M.player)return;
    setFLASH('');
    const typed=(($('roomIn')&&$('roomIn').value)||'').trim(),code=normRoom(typed);
    if(t.dataset.room==='create'){
      if(PRESETS[PRESET].buy>shownBalance()){setFLASH(tr('余额不够盲注 {sb}/{bb} 的最低买入，在大厅换一个小一点的盲注吧。',{sb:PRESETS[PRESET].sb,bb:PRESETS[PRESET].bb}));renderMenu();return;}
      const room=typed?code:newRoomCode();
      if(room.length<3){setFLASH(tr('房间号要 3–8 位字母或数字。'));renderMenu();return;}
      LOBBY.open=null;LOBBY.confirm={code:room,typed:!!typed};renderMenu();$('cpPw')&&$('cpPw').focus();return;
    }
    if(!code){setFLASH(tr('填一下房间号，或者新开一个房间'));renderMenu();return;}
    if(code.length<3){setFLASH(tr('房间号要 3–8 位字母或数字。'));renderMenu();return;}
    enterOnline(code,false);return;
  }
  if(t.dataset.confirmCreate){
    if(!LOBBY.confirm||!readStakeForm())return;
    enterOnline(LOBBY.confirm.code,true,($('cpPw')&&$('cpPw').value)||'');return;
  }
  if(t.dataset.cancelCreate){if(LOBBY.confirm&&LOBBY.confirm.typed)M.prefill=LOBBY.confirm.code;LOBBY.confirm=null;setFLASH('');renderMenu();return;}
  if(t.dataset.openRoom){
    const c=t.dataset.openRoom;LOBBY.open=LOBBY.open===c?null:c;setFLASH('');renderRooms();
    $('rjPw')&&$('rjPw').focus();
    return;
  }
  if(t.dataset.enterRoom){enterOnline(t.dataset.enterRoom,false,($('rjPw')&&$('rjPw').value)||'');return;}
  if(t.dataset.copy){
    const txt=roomLink();
    const done=()=>{t.textContent=tr('已复制');setTimeout(()=>{t.textContent=tr('复制链接');},1500);};
    try{navigator.clipboard.writeText(txt).then(done,()=>{const el=$('linktxt');if(el){const r=document.createRange();r.selectNodeContents(el);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);}});}catch(e){}
    return;
  }
  if(t.id==='exitBtn'||t.dataset.exitOpen){
    const me=S&&S.seats[mySeat()];
    if(me&&lockedIn(me))$('exitPopup').hidden=false;else exitTable();
    return;
  }
  if(t.dataset.overtime){dismissOvertime();return;}
  if(t.dataset.exit){$('exitPopup').hidden=true;if(t.dataset.exit==='ok')exitTable();return;}
  if(t.dataset.view){setVIEW(t.dataset.view);render();window.scrollTo&&window.scrollTo(0,0);return;}
  if(t.dataset.moneyGo){confirmMoney();return;}
  if(t.dataset.m){money(t.dataset.m);return;}
  if(t.dataset.autotidy){toggleAutoTidy();return;}
  if(t.dataset.tidy){tidy();return;}
  if(t.dataset.bank){toggleBuy();return;}
  if(t.dataset.pre){setPre(t.dataset.pre);return;}
  if(t.dataset.statsReset){if(t.dataset.sure){if(M.solo)serverCmd('clearstats');else{store.set('poker.stats.bots','');if(S&&S.stats)delete S.stats.local;render();}}else{t.dataset.sure='1';t.textContent=tr('确认清空？');}return;}
  if(t.dataset.emoOpen){setEMO_OPEN(!EMO_OPEN);renderHero();return;}
  if(t.dataset.emo){sendEmoji(t.dataset.emo);return;}
  if(t.dataset.approve){M.server?serverCmd('approve',t.dataset.approve,true):approveBuy(t.dataset.approve,true);return;}
  if(t.dataset.deny){M.server?serverCmd('approve',t.dataset.deny,false):approveBuy(t.dataset.deny,false);return;}
  if(t.dataset.kick){
    if(M.server){ // ask once more on this button, then the server removes them
      if(t.dataset.sure){serverCmd('kick',t.dataset.kick);}else{t.dataset.sure='1';t.textContent=tr('确认请出？');t.classList.add('warn');}
      return;
    }
    kick(t.dataset.kick);return;
  }
  if(t.dataset.unkick){M.server?serverCmd('unkick',t.dataset.unkick):unkick(t.dataset.unkick);return;}
  const a=t.dataset.a;
  if(a==='next'){if(S.street!=='done')return;if(M.solo)serverCmd('next');else if(M.host)startHand();return;}
  if(a==='join'){joinTable();return;}
  if(a==='leave'){leaveTable();return;}
  if(t.dataset.vote){vote(Number(t.dataset.vote));return;}
  if(!myTurn()){return;}
  const p=S.seats[mySeat()];
  if(a==='cancel'){cancelAction();renderHero();return;}
  if(a==='confirm'){confirmAction();return;}
  if(a==='raise-go'){commitRaise();return;}
  if(t.dataset.raiseTo!=null){setRaiseAt(Number(t.dataset.raiseTo));return;}
  if(t.dataset.raiseCustom){const el=$('raiseNum');if(el){el.focus();el.select();}return;}
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
  if(a==='call'){selectCall();return;}
  if(a==='raise'){openBetMenu();return;}
  if(a==='bet'){placeBet();return;}
});
document.addEventListener('keydown',e=>{
  const seatEl=(e.key==='Enter'||e.key===' ')&&e.target.closest&&e.target.closest('[data-seat]');
  if(seatEl){e.preventDefault();seatEl.click();return;}
  if(e.key==='Escape'&&PROFILE){setPROFILE(null);if(S)renderTable();return;}
});
