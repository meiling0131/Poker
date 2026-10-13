// Game constants and the Firebase project config.

// Verve server for online rooms (wss/https URL of the Cloudflare Worker). Empty = rooms use Firebase.
export const SERVER_URL='https://verve.meiling-wang0131.workers.dev';
/* Firebase 配置：把 Firebase 控制台「项目设置 → 你的应用 → SDK 设置和配置」
   里给你的 firebaseConfig 整段贴在这里。 */
export const FIREBASE_CONFIG={
  apiKey:"AIzaSyBNHyrxthSeOqc6fFccYMnWgqK_Zpb7pls",
  authDomain:"poker-df447.firebaseapp.com",
  projectId:"poker-df447",
  storageBucket:"poker-df447.firebasestorage.app",
  messagingSenderId:"55898552743",
  appId:"1:55898552743:web:f244db4f8df913f0b95e82"
};
export const STREET_CN={idle:'等待',dealing:'发牌',preflop:'翻牌前',flop:'翻牌',turn:'转牌',river:'河牌',done:'结算'};
export const BETTING=['preflop','flop','turn','river'];
export const BUY=200,ACT_MS=45000,NEXT_MS=8000,ONLINE_MIN=2,ONLINE_MAX=10;
export const BUY_SET=[[25,4],[10,6],[5,6],[1,10]];
export const DENOMS=[[25,'g'],[10,'b'],[5,'r'],[1,'w']];
// type 'whale' (奶龙, 土豪): sticky — calls everything until the river, then folds without two pair; rebuys two hands.
// type 'tag' (Joe): disciplined, but loves to raise before the flop — opens 12.5–37.5BB and doubles any raise.
// type 'peeker' (sc): loves to see the flop, lets go the moment his hand isn't good; with a big hand
//   he likes to check-call, or bet just a little (under 25BB) unless he has the nuts.
// type 'bluffer' (Kmetsch): plays a few real hands straight, then starts bluffing; repeats.
export const BOTS=[['Joe',{loose:.15,aggr:.75,type:'tag'}],['sc',{loose:.75,aggr:.20,type:'peeker'}],['老周',{loose:.15,aggr:.25}],
  ['奶龙',{loose:.95,aggr:.80,type:'whale'}],['Kmetsch',{loose:.40,aggr:.55,type:'bluffer'}],['阿芳',{loose:.80,aggr:.60}]];
// shown on a bot's profile card (tap the seat)
export const BOT_BLURB={
  Joe:'翻前爱加倍：好牌开 25/50/75，被加注就翻倍；翻牌后守纪律，不乱诈唬。',
  sc:'爱看牌，没中就弃（「其实我能赢」）；大牌喜欢 check-call 或者小注。',
  老周:'很紧很稳，只打好牌，很少诈唬。',
  奶龙:'土豪：粘牌爱看牌，但大钱要有大牌；加注时说「我说白了」，输光一次买两手。',
  Kmetsch:'先打几手实牌，再开始诈唬；只骗一两个人，不骗跟注站。',
  阿芳:'爱入池，也敢加注，手松但不傻。',
};
export const BOT_STYLE=Object.fromEntries(BOTS);
export const DAILY_LIMIT=1000;
// 人机模式：你买入之前（或输光之后）牌桌一直等你，不让机器人自己打
export const BOTS_WAIT='买一手 +200 就开始发牌';
