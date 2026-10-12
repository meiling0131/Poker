// Cards, fair shuffling, hand evaluation and Monte Carlo equity. No DOM, no state.

export const SUITS=['♠','♥','♦','♣'];
export const rankOf=c=>c%13+2, suitOf=c=>Math.floor(c/13);
export const rankStr=r=>({10:'10',11:'J',12:'Q',13:'K',14:'A'})[r]||String(r);
export function randInt(n){const buf=new Uint32Array(1),lim=Math.floor(0x100000000/n)*n;let x;do{crypto.getRandomValues(buf);x=buf[0];}while(x>=lim);return x%n;}
export function shuffledDeck(){const d=[];for(let i=0;i<52;i++)d.push(i);for(let i=51;i>0;i--){const j=randInt(i+1);const t=d[i];d[i]=d[j];d[j]=t;}return d;}

export function enc(cat,ks){let s=cat;for(let i=0;i<5;i++)s=s*16+(ks[i]||0);return s;}
export function eval5(a,b,c,d,e){
  const r=[a%13+2,b%13+2,c%13+2,d%13+2,e%13+2].sort((x,y)=>y-x);
  const sa=(a/13)|0;
  const flush=((b/13)|0)===sa&&((c/13)|0)===sa&&((d/13)|0)===sa&&((e/13)|0)===sa;
  const g=[],cn=[];
  for(let i=0;i<5;){let j=i;while(j<5&&r[j]===r[i])j++;g.push(r[i]);cn.push(j-i);i=j;}
  const idx=g.map((_,i)=>i).sort((x,y)=>cn[y]-cn[x]||g[y]-g[x]);
  const G=idx.map(i=>g[i]),C=idx.map(i=>cn[i]);
  let st=0;
  if(G.length===5){if(r[0]-r[4]===4)st=r[0];else if(r[0]===14&&r[1]===5)st=5;}
  if(st&&flush)return enc(8,[st]);
  if(C[0]===4)return enc(7,G);
  if(C[0]===3&&C[1]===2)return enc(6,G);
  if(flush)return enc(5,r);
  if(st)return enc(4,[st]);
  if(C[0]===3)return enc(3,G);
  if(C[0]===2&&C[1]===2)return enc(2,G);
  if(C[0]===2)return enc(1,G);
  return enc(0,r);
}
export function best7(cs){const n=cs.length;let best=-1;
  for(let a=0;a<n-4;a++)for(let b=a+1;b<n-3;b++)for(let c=b+1;c<n-2;c++)for(let d=c+1;d<n-1;d++)for(let e=d+1;e<n;e++){
    const v=eval5(cs[a],cs[b],cs[c],cs[d],cs[e]);if(v>best)best=v;}
  return best;}
export function handName(s){
  const d=[];let x=s;for(let i=0;i<6;i++){d.unshift(x%16);x=Math.floor(x/16);}
  const k=d.slice(1).map(rankStr);
  switch(d[0]){case 0:return `高牌 ${k[0]}`;case 1:return `一对 ${k[0]}`;case 2:return `两对 ${k[0]}/${k[1]}`;
    case 3:return `三条 ${k[0]}`;case 4:return `顺子 到${k[0]}`;case 5:return `同花 ${k[0]}高`;
    case 6:return `葫芦 ${k[0]}带${k[1]}`;case 7:return `四条 ${k[0]}`;case 8:return d[1]===14?'皇家同花顺':`同花顺 到${k[0]}`;}
}
export function describe(hole,board){
  if(board.length>=3)return handName(best7(hole.concat(board)));
  const a=rankOf(hole[0]),b=rankOf(hole[1]);
  if(a===b)return `一对 ${rankStr(a)}`;
  return `${rankStr(Math.max(a,b))}${rankStr(Math.min(a,b))}${suitOf(hole[0])===suitOf(hole[1])?' 同花':''}`;
}
export function equity(hole,board,nOpp,iters){
  if(nOpp<=0)return 1;
  const used=new Uint8Array(52);hole.concat(board).forEach(c=>used[c]=1);
  const rest=[];for(let c=0;c<52;c++)if(!used[c])rest.push(c);
  const needB=5-board.length,need=needB+2*nOpp;let won=0;
  for(let it=0;it<iters;it++){
    for(let k=0;k<need;k++){const j=k+Math.floor(Math.random()*(rest.length-k));const t=rest[k];rest[k]=rest[j];rest[j]=t;}
    const b=board.slice();for(let k=0;k<needB;k++)b.push(rest[k]);
    const my=best7([hole[0],hole[1]].concat(b));let ties=0,lost=false;
    for(let o=0;o<nOpp;o++){const v=best7([rest[needB+2*o],rest[needB+2*o+1]].concat(b));if(v>my){lost=true;break;}if(v===my)ties++;}
    if(!lost)won+=1/(ties+1);
  }
  return won/iters;
}

export const cardTxt=c=>rankStr(rankOf(c))+SUITS[suitOf(c)];
