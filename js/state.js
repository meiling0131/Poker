// Shared mutable runtime state. Other modules read these live bindings and write through the setters.

// M.mode: null (menu) | 'bots' | 'online'
export const M={room:null,creating:false,nick:'',fbError:null,mode:null,db:null,user:null,uid:null,me:null,owner:false,host:false,online:false,ready:false,canWrite:null,keys:null,booted:false};
export let S=null;          // table state (shared doc in online mode)
export let H=[],DECK=[];    // host-only secrets
export let SEATDOCS={};     // host: uid -> seat doc
export let MYHOLE={hand:-1,c:null},MYDOC=null;
export let GEN=0,TT=null,SPEED=650,SUBMITTED=-1,FLASH='',CONFIRM_RESET=false,VIEW='table';
export let LOCAL_B=0,LOCAL_C=0,UNSUBS=[],SESSION=0,PUSH={1:0,5:0,10:0,25:0},PUSH_TURN=-1,VOTED=null;
export let tableRef=null,secretRef=null,myRef=null,recRef=null;

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
