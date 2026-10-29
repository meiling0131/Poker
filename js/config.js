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
// Bot styles (BOT_PLAYERS below), each after a well-known player:
// type 'xuan' (Joe, after Tan Xuan): loose and aggressive — opens big (12.5BB, 25 / 37.5BB with a good hand),
//   steals from late position and doubles a raise; bets more and bigger after the flop, keeps barrelling
//   and wants the stacks in with a strong hand.
// type 'hellmuth' (sc, after Phil Hellmuth): tight and passive — limps and calls small raises to see the flop,
//   lets go the moment his hand isn't good; with a big hand he check-calls or bets just a little (under 25BB)
//   unless he has the nuts, and folds a big river bet from a player who rarely bets.
// type 'keating' (奶龙, after Alan Keating): a rich amateur — plays almost every hand and raises a lot, calls
//   down with a pair, hero-calls the river and now and then overbets it; rebuys two hands at a time (rebuy).
// type 'wangye' (Kmetsch, after 王烨 Wang Ye): solid before the flop; slow-plays a big hand (calls the flop and
//   turn, then check-raises the river, all in when the stack is not much more than the pot) and after a few
//   real hands runs the same line as a bluff, once or twice — heads up only, never into a calling station.
// type 'st' (ST, after the high-stakes regular Zuo "ST" Wang): aggressive and hard to read — limps some hands
//   (small pairs, suited connectors, now and then a monster to limp-reraise), opens big with the rest,
//   traps strong hands to check-raise (the flop check-raise all in), and hero-calls big river bets.
// type 'dwan' (dwan, after Tom "durrrr" Dwan): hyper-loose-aggressive — plays many hands, 3-bets light,
//   floats in position, barrels the turn and river, overbets the nuts and blocker bluffs, and calls down
//   lighter against players who bet a lot.
// A bot is known by its fixed player id everywhere: 16 characters, ubot, zeros, then the pinyin of its old table name.
// `name` is what players.name is seeded with; the copy in the database is what gets shown (BOT_NAMES).
// `table` is the old seat name, only used to read tables saved before bots had ids.
// blurb is shown on a bot's profile card (tap the seat): a few words only, so a player learns a bot's game by playing it.
export const BOT_PLAYERS=[
  {id:'ubot000000000joe',name:'🤖 Joe',table:'Joe',style:{loose:.55,aggr:.90,type:'xuan'},
    blurb:'松凶，出手大。'},
  {id:'ubot0000000000sc',name:'🤖 sc',table:'sc',style:{loose:.35,aggr:.15,type:'hellmuth'},
    blurb:'偏紧，求稳。'},
  {id:'ubot00000laozhou',name:'🤖 ST',table:'老周',style:{loose:.70,aggr:.70,type:'st'},
    blurb:'凶，难以捉摸。'},
  {id:'ubot00000nailong',name:'🤖 奶龙',table:'奶龙',style:{loose:.95,aggr:.80,type:'keating',rebuy:2},
    blurb:'土豪，爱玩。'},
  {id:'ubot00000kmetsch',name:'🤖 Kmetsch',table:'Kmetsch',style:{loose:.35,aggr:.60,type:'wangye'},
    blurb:'稳健，深藏不露。'},
  {id:'ubot0000000afang',name:'🤖 dwan',table:'阿芳',style:{loose:.90,aggr:.90,type:'dwan'},
    blurb:'超松超凶。'},
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
