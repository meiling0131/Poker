// Shared runtime state. Other modules read these live bindings and write through the setX() functions below.

// ---- session ----
// M.mode: null (menu) | 'bots' | 'online'
export const M={room:null,creating:false,nick:'',fbError:null,mode:null,db:null,user:null,uid:null,me:null,owner:false,host:false,online:false,ready:false,canWrite:null,keys:null,booted:false};
export let SESSION=0;      // bumped on every mode switch; async work from an older session drops its result
export let GEN=0;          // bumped when the table restarts; timers from an older generation do nothing
export let UNSUBS=[];      // Firestore listeners to detach on the next mode switch

// ---- the table ----
export let S=null;         // table state; in online mode this is the shared room doc

// ---- host only ----
export let H=[];           // hole cards per seat
export let DECK=[];        // the rest of the deck
export let SEATDOCS={};    // uid → that player's seat doc
export let TT=null;        // current action timer

// ---- my seat in an online room ----
export let MYHOLE={hand:-1,c:null};  // my decrypted hole cards
export let MYDOC=null;               // my own seat doc
export let SUBMITTED=-1;             // turn number of the action I sent and the host has not applied yet
export let LOCAL_B=0,LOCAL_C=0;      // my buy / cash-out counters, written to my seat doc
export let tableRef=null,secretRef=null,myRef=null,recRef=null;

// ---- local UI ----
export let FLASH='';                 // one-line message under the controls
export let VIEW='table';             // 'table' | 'records'
export let CONFIRM_RESET=false;      // 重置牌桌 waits for a second tap
export let PUSH={1:0,5:0,10:0,25:0}; // chips pushed into the bet zone, by denomination
export let PUSH_TURN=-1;             // the turn PUSH belongs to
export let VOTED=null;               // my run-it-twice vote, until the host records it
export let SPEED=650;                // bots mode pace (ms)
export let PROFILE=null;             // book key of the player whose profile card is open

// The UI registers its renderers here, so game code can redraw without importing the UI.
export const view={render(){},renderHero(){}};

export function setCONFIRM_RESET(v){CONFIRM_RESET=v;}
export function setDECK(v){DECK=v;}
export function setFLASH(v){FLASH=v;}
export function setGEN(v){GEN=v;}
export function setH(v){H=v;}
export function setLOCAL_B(v){LOCAL_B=v;}
export function setLOCAL_C(v){LOCAL_C=v;}
export function setMYDOC(v){MYDOC=v;}
export function setMYHOLE(v){MYHOLE=v;}
export function setPUSH(v){PUSH=v;}
export function setPUSH_TURN(v){PUSH_TURN=v;}
export function setS(v){S=v;}
export function setSEATDOCS(v){SEATDOCS=v;}
export function setSESSION(v){SESSION=v;}
export function setSPEED(v){SPEED=v;}
export function setSUBMITTED(v){SUBMITTED=v;}
export function setTT(v){TT=v;}
export function setUNSUBS(v){UNSUBS=v;}
export function setVIEW(v){VIEW=v;}
export function setVOTED(v){VOTED=v;}
export function setmyRef(v){myRef=v;}
export function setrecRef(v){recRef=v;}
export function setsecretRef(v){secretRef=v;}
export function settableRef(v){tableRef=v;}
export function setPROFILE(v){PROFILE=v;}
