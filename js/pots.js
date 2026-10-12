// Main pot and side pots from what each seat put in this hand. No DOM, no state.
// seats: [{total, inHand, folded}] → [{amount, elig:[seat index…]}], main pot first.
// Chips from folded seats above the last live level go to the last pot.
export function buildPots(seats){
  const n=seats.length,con=seats.map(p=>p.total),pots=[];
  for(;;){
    const lv=seats.map((p,i)=>i).filter(i=>seats[i].inHand&&!seats[i].folded&&con[i]>0);
    if(!lv.length)break;
    const level=Math.min(...lv.map(i=>con[i]));
    let amt=0;for(let i=0;i<n;i++){const t=Math.min(con[i],level);amt+=t;con[i]-=t;}
    pots.push({amount:amt,elig:lv});
  }
  const left=con.reduce((a,b)=>a+b,0);if(left&&pots.length)pots[pots.length-1].amount+=left;
  return pots;
}
