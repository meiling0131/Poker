// Small helpers shared by every module.

export const $=id=>document.getElementById(id);
export const fmt=n=>Number(n).toLocaleString('en-US');
export const sgn=n=>(n>0?'+':n<0?'−':'')+fmt(Math.abs(n));
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const store={get(k){try{return localStorage.getItem(k);}catch(e){return null;}},set(k,v){try{localStorage.setItem(k,v);}catch(e){}}};

export function localDay(){const d=new Date();return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;}
