// Game constants and the Firebase project config.

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
// type 'whale' (奶龙, 土豪): sees every flop, calls every bet, rebuys two hands when busted.
// type 'tag' (Joe): tight and disciplined; with a good hand he raises big; never bluffs.
export const BOTS=[['Joe',{loose:.15,aggr:.75,type:'tag'}],['小雨',{loose:.65,aggr:.30}],['老周',{loose:.15,aggr:.25}],
  ['奶龙',{loose:.95,aggr:.80,type:'whale'}],['大卫',{loose:.40,aggr:.50}],['阿芳',{loose:.80,aggr:.60}]];
export const BOT_STYLE=Object.fromEntries(BOTS);
export const DAILY_LIMIT=1000;
// 人机模式：你买入之前（或输光之后）牌桌一直等你，不让机器人自己打
export const BOTS_WAIT='买一手 +200 就开始发牌';
