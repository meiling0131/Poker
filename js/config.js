// Game constants and where the Verve server is.

// The Verve server (https URL of the Cloudflare Worker): regular tables, friends rooms and the database.
// Pages served by the Worker itself connect to their own address instead (see net.js); this one is for
// copies served elsewhere, like GitHub Pages. Empty: such a copy offers practice only.
export const SERVER_URL='https://verve.vpoker.workers.dev';
export const STREET_CN={idle:'等待',dealing:'发牌',preflop:'翻牌前',flop:'翻牌',turn:'转牌',river:'河牌',done:'结算'};
export const BETTING=['preflop','flop','turn','river'];
export let BUY=200;
export function setBUY(n){BUY=n;}
export const ACT_MS=45000,NEXT_MS=8000,ONLINE_MIN=2,ONLINE_MAX=10;
// how long the table animates after dealing hole cards / a flop / a turn or river; bots wait it out
export const FLOP_MS=1000,CARD_MS=700;
// Dealing: one card every DEAL_STEP ms, round the table twice; each takes DEAL_FLY ms to land. The bots wait
// for the last card (dealTime) before they act, on every table, so the deal is never cut short.
export const DEAL_STEP=200,DEAL_FLY=400;
export const dealTime=players=>Math.max(0,2*players-1)*DEAL_STEP+DEAL_FLY;
export const BUY_SET=[[25,4],[10,6],[5,6],[1,10]];
export const DENOMS=[[25,'g'],[10,'b'],[5,'r'],[1,'w']];
// Bot styles (BOT_PLAYERS below):
// type 'whale' (奶龙, 土豪): sticky — calls everything until the river, then folds without two pair; rebuys two hands.
// type 'tag' (Joe): disciplined, but loves to raise before the flop — opens 12.5–37.5BB and doubles any raise.
// type 'peeker' (sc): loves to see the flop, lets go the moment his hand isn't good; with a big hand
//   he likes to check-call, or bet just a little (under 25BB) unless he has the nuts.
// type 'bluffer' (Kmetsch): plays a few real hands straight, then starts bluffing; repeats.
// type 'st' (ST, after the high-stakes regular Zuo "ST" Wang): aggressive and hard to read — limps some hands
//   (small pairs, suited connectors, now and then a monster to limp-reraise), opens big with the rest,
//   traps strong hands to check-raise (the flop check-raise all in), and hero-calls big river bets.
// type 'dwan' (dwan, after Tom "durrrr" Dwan): hyper-loose-aggressive — plays many hands, 3-bets light,
//   floats in position, barrels the turn and river, overbets the nuts and blocker bluffs, and calls down
//   lighter against players who bet a lot.
// A bot is known by its fixed player id everywhere: 16 characters, ubot, zeros, then the pinyin of its old table name.
// `name` is what players.name is seeded with; the copy in the database is what gets shown (BOT_NAMES).
// `table` is the old seat name, only used to read tables saved before bots had ids.
// blurb is shown on a bot's profile card (tap the seat).
export const BOT_PLAYERS=[
  {id:'ubot000000000joe',name:'🤖 Joe',table:'Joe',style:{loose:.15,aggr:.75,type:'tag'},
    blurb:'翻前爱加倍：好牌开 25/50/75，被加注就翻倍；翻牌后守纪律，不乱诈唬。'},
  {id:'ubot0000000000sc',name:'🤖 sc',table:'sc',style:{loose:.75,aggr:.20,type:'peeker'},
    blurb:'爱看牌，没中就弃（「其实我能赢」）；大牌喜欢 check-call 或者小注。'},
  {id:'ubot00000laozhou',name:'🤖 ST',table:'老周',style:{loose:.70,aggr:.70,type:'st'},
    blurb:'王佐（ST Wang）式豪客打法：翻前时而 limp、时而大加注，难以捉摸；好牌爱过牌加注设陷阱，河牌敢英雄跟注。'},
  {id:'ubot00000nailong',name:'🤖 奶龙',table:'奶龙',style:{loose:.95,aggr:.80,type:'whale'},
    blurb:'土豪：粘牌爱看牌，但大钱要有大牌；加注时说「我说白了」，输光一次买两手。'},
  {id:'ubot00000kmetsch',name:'🤖 Kmetsch',table:'Kmetsch',style:{loose:.40,aggr:.55,type:'bluffer'},
    blurb:'先打几手实牌，再开始诈唬；只骗一两个人，不骗跟注站。'},
  {id:'ubot0000000afang',name:'🤖 dwan',table:'阿芳',style:{loose:.90,aggr:.90,type:'dwan'},
    blurb:'Tom Dwan（durrrr）式超松凶：入池多、爱 3-bet，敢连开三枪、超池下注诈唬；看你弱就加压，也会抓诈唬。'},
];
// ST and dwan were 老周 and 阿芳: a bot keeps its id (and so its history) when it is renamed
export const BOT={JOE:'ubot000000000joe',SC:'ubot0000000000sc',ST:'ubot00000laozhou',NAILONG:'ubot00000nailong',KMETSCH:'ubot00000kmetsch',DWAN:'ubot0000000afang'};
export const BOT_STYLE=Object.fromEntries(BOT_PLAYERS.map(b=>[b.id,b.style]));
export const BOT_BLURB=Object.fromEntries(BOT_PLAYERS.map(b=>[b.id,b.blurb]));
export const BOT_NAMES=Object.fromEntries(BOT_PLAYERS.map(b=>[b.id,b.name]));
export const isBotId=k=>typeof k==='string'&&Object.prototype.hasOwnProperty.call(BOT_NAMES,k);
export function setBotNames(rows){
  for(const r of rows||[])if(r&&isBotId(r.id)&&typeof r.name==='string'&&r.name.trim())BOT_NAMES[r.id]=r.name.trim();
}
export const botIdOfTable=name=>(BOT_PLAYERS.find(b=>b.table===name)||{}).id||null;
