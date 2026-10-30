// English for i18n.js. EN: the Chinese text (a key as tr() and N_() are given it, {name} placeholders kept) →
// its English. EN_ACTS and EN_RULES put the text the dealer writes into the table's state into English.
export const EN={
  // ---- the lobby
  '今日最佳':"Today's best",'昨日最佳':"Yesterday's best",'本周最佳':'Best this week','本月最佳':'Best this month','历史最佳':'Best ever',
  '排行榜':'Leaderboard','暂无':'None yet',
  '请留尊姓大名':'Leave your name','正在清理牌桌':'Closing the tables','今日余额 {n}':"Today's balance {n}",
  '可用余额 · {t} 后重置':'Available · resets in {t}',
  '盲注':'Blinds','盲注 {sb}/{bb}，最低买入 {buy}':'Blinds {sb}/{bb}, minimum buy-in {buy}','最低买入 {buy}':'Min. buy-in {buy}',
  '进入游戏':'Play','练习模式':'Practice','好友模式':'Friends','设置':'Settings','关于':'About',
  // the header
  '牌桌':'Table','记录':'Records','暂未开放':'Not open yet','退出牌桌':'Leave table',
  '房间 {code}':'Room {code}','正常 · 7 人':'Regular · 7 players','练习 · 7 人':'Practice · 7 players','盲注 {sb}/{bb}':'Blinds {sb}/{bb}','第 {n} 手':'Hand {n}',
  // names
  '修改名字':'Change name','修改名字为 {name}？':'Change your name to {name}?','您只能修改一次名字':'You can change your name only once.',
  '留下名字，就能进入房间 {code}':'Leave a name to enter room {code}','您的名字':'Your name','以后再说':'Later',
  '名字只能修改一次':'You can change your name only once','名字不能以 # 或🤖开头':"A name can't start with # or 🤖",
  '正在清理牌桌，请于 12:00AM 后再留名。':'The tables are closing. Leave your name after 12:00 AM.',
  '没能保存，请再试一次。':"Couldn't save. Please try again.",'请填写名字':'Please enter a name',
  '确认清除账号？':'Clear this account?','一经确认，您将无法继续使用 {name} 游玩。':"Once you confirm, you can't play as {name} anymore.",
  '你':'You','房主':'Host','玩家':'Player',
  // 查看数据 (stats)
  '最大赢池':'Biggest win','今天还没有赢过底池。':"You haven't won a pot today.",'对手弃牌，未亮牌':'Everyone folded; no cards shown',
  '正在读取…':'Loading…','没能读取数据，请稍后再试。':"Couldn't load the stats. Please try again later.",
  '打完第一手后开始统计。':'Stats start after your first hand.','练习模式：本次练习的数据，不计入排行。':'Practice: stats for this session only, not ranked.',
  '占今日手数的 {p}%':"{p}% of today's hands",'占本次练习手数的 {p}%':"{p}% of this session's hands",
  '今日：{n} / {d} {u}':'Today: {n} / {d} {u}','本次练习：{n} / {d} {u}':'This session: {n} / {d} {u}',
  '手数':'Hands','今天发到你手里的总手数。':'Hands dealt to you today.',
  '赢的手数':'Hands won','今天赢得至少一个底池的手数，平分也算。':'Hands today in which you won at least one pot, split pots included.',
  '入池率':'Voluntarily in pot','手':'hands',
  '翻牌前主动把筹码放进底池（跟注或加注，盲注不算）的手数，占所有手数的比例。越高说明玩得越松。':
    "The share of hands in which you chose to put chips in before the flop (a call or a raise; blinds don't count). The higher it is, the looser you play.",
  '翻前加注率':'Preflop raise','翻牌前加注的手数，占所有手数的比例。和入池率越接近，打法越凶。':
    'The share of hands in which you raised before the flop. The closer it is to VPIP, the more aggressively you play.',
  '偷盲率':'Attempt to steal','次机会':'chances',
  '坐在关煞位、庄位或小盲位，而且前面所有人都弃牌时，选择加注的比例。':
    'How often you raise from the cutoff, the button or the small blind when everyone before you has folded.',
  '再加注率':'3-bet','翻牌前面对一次开局加注时再加注的次数，占所有手数的比例。':'Re-raises of an opening raise before the flop, as a share of all hands.',
  '摊牌率':'Went to showdown','次看翻牌':'flops seen','看到翻牌之后，一直坚持到摊牌的比例。':'After seeing the flop, how often you stayed in to the showdown.',
  '摊牌胜率':'Won at showdown','次摊牌':'showdowns','进入摊牌后赢得底池的比例。平分也算赢。':'How often you win the pot at a showdown. A split counts as a win.',
  '翻后胜率':'Won when saw flop','看到翻牌后最终赢得底池的比例，包括对手弃牌让你赢。':
    'After seeing the flop, how often you end up winning the pot, including when everyone else folds.',
  // 设置 (settings)
  '语言':'Language','游戏音效':'Sound effects','关闭§off':'Off','启用':'On','机器人速度':'Bot speed','较慢':'Slow','中等':'Medium','较快':'Fast',
  '一楼':'1st floor','会议室 · 胡桃木长桌':'Meeting room · walnut table','二楼':'2nd floor','休息区 · 皮沙发':'Lounge · leather sofas',
  '清除账号':'Clear account','确认':'Confirm','取消':'Cancel','返回':'Back','关闭':'Close',
  // 关于 (about)
  '关于 Verve Poker':'About Verve Poker',
  'Verve Poker 是为手机设计的无限注德州扑克，打开网页就能玩，不用下载安装。':
    "Verve Poker is no-limit Texas Hold'em made for phones. It runs in the browser, so there is nothing to install.",
  '每天 1,000':'1,000 a day',
  '每人每天有 1,000 余额，美东时间午夜重置；第二天重新留名，从 1,000 开始。':
    'Everyone gets a balance of 1,000 each day. It resets at midnight US Eastern; the next day you leave a name again and start from 1,000.',
  '选一个盲注（1/2、2/5、5/10），和六个风格各异的机器人同桌。买入、下注和每一次输赢都记在服务器上，计入排行榜。':
    'Pick a stake (1/2, 2/5 or 5/10) and sit down with six bots, each with its own style. Buy-ins, bets and every win and loss are kept on the server and count for the leaderboard.',
  '用练习筹码随便打，不记录，也不计入排行。':'Play with practice chips. Nothing is recorded or ranked.',
  '创建或加入房间（可以设密码），在「记录」里把邀请链接发给朋友，满 2 人开局。':
    'Create or join a room (with a password if you like) and send your friends the invite link from Records. A hand starts once two players are seated.',
  '今日、昨日、本周、本月和历史最佳，比的是余额加上桌上的筹码。':
    'The best of today, yesterday, this week, this month and all time: your balance plus the chips in front of you.',
  '查看数据':'Stats','在大厅点自己的名字，看今天的数据；在牌桌上点任意座位，看那位玩家的数据。':
    "Tap your name in the lobby for your stats today, or tap any seat at the table for that player's.",
  '每天收桌':"The day's close",'美东时间 23:55 起不再开新牌局；到 00:05 还没打完的牌局会取消，下注全部退回。':
    'From 23:55 US Eastern no new hands start. A hand still running at 00:05 is called off and every bet goes back.',
  '添加到主屏幕':'Add to Home Screen',
  'iPhone 在 Safari 里点「分享 → 添加到主屏幕」，安卓在 Chrome 菜单里选「添加到主屏幕」，之后就能像 App 一样全屏打开。':
    "On iPhone, tap Share → Add to Home Screen in Safari; on Android, choose Add to Home screen in Chrome's menu. It then opens full-screen, like an app.",
  // 好友模式 (friends)
  '房间':'Rooms','加载中…':'Loading…','点一下就能进':'Tap one to join','现在没有开着的房间，在下面创建一个吧。':'No rooms are open right now. Create one below.',
  '有密码':'Password protected','{n} 人在线':'{n} online','{n} 人入座':'{n} seated','房主 {name}':'Host {name}','房间密码':'Room password','进入':'Enter',
  '创建房间 {code}':'Create room {code}','盲注 {sb}/{bb} · 最低买入 {buy} · 满 2 人开局':'Blinds {sb}/{bb} · minimum buy-in {buy} · starts with 2 players',
  '密码（不填就没有密码）':'Password (leave empty for none)','确认创建':'Create',
  '房间号（创建时不填就随机）':'Room code (empty for a random one)','房间号':'Room code','加入房间':'Join room','创建房间':'Create room',
  '新房间用大厅选的盲注 {sb}/{bb}，每次买入 {buy}。':'A new room plays at the blinds picked in the lobby, {sb}/{bb}, with buy-ins of {buy}.',
  '余额不够盲注 {sb}/{bb} 的最低买入，在大厅换一个小一点的盲注吧。':"Your balance doesn't cover the minimum buy-in at {sb}/{bb}. Pick smaller blinds in the lobby.",
  '房间号要 3–8 位字母或数字。':'A room code is 3–8 letters or digits.','填一下房间号，或者新开一个房间':'Enter a room code, or create a new room',
  // joining, and what the server says
  '连接失败，请稍后再试。':"Couldn't connect. Please try again later.",'联机连接失败，请稍后再试。':"Couldn't connect to the room. Please try again later.",
  '房间号 {code} 已经有人在用了，换一个吧。':'Room {code} is already taken. Pick another code.',
  '没有房间 {code}。检查一下房间号，或者自己创建一个。':'There is no room {code}. Check the code, or create the room yourself.',
  '这个座位已经在别的设备上用过了，进不去。':'This seat is already in use on another device.',
  '正在清理牌桌，请于 12:00AM 后再来。':'The tables are closing. Come back after 12:00 AM.',
  '进不了牌桌。':"Couldn't join the table.",'进不了这个房间。':"Couldn't join this room.",'密码不对，再试一次。':'Wrong password. Try again.','这个房间有密码。':'This room has a password.',
  '余额不足，已更新为最新余额。':'Not enough balance. Your balance has been updated.',
  '桌上筹码不足，已更新为最新筹码。':'Not enough chips on the table. Your chips have been updated.',
  '金额必须是最低买入的整数倍。':'The amount must be a multiple of the minimum buy-in.',
  '找不到你的账号，请回到主页留下名字。':"We couldn't find your account. Go back to the lobby and leave a name.",
  '你已离开座位，买入已取消。':'You left your seat, so the buy-in was cancelled.',
  '暂时无法买入或取出，请稍后再试。':"Buying in or cashing out isn't available right now. Please try again later.",
  '操作失败，请再试一次。':'Something went wrong. Please try again.','牌桌正在清理，不能再买入或取出。':"The table is closing; you can't buy in or cash out now.",
  '加入失败，请检查网络后再试一次。':"Couldn't join. Check your connection and try again.",
  '提交失败，请再点一次。':"Couldn't send that. Tap again.",'提交失败，请再试一次。':"Couldn't send that. Please try again.",
  '整理失败，请再试一次。':"Couldn't tidy the chips. Please try again.",'表情发送失败':"Couldn't send the emoji",
  // the table
  '正在等待连接...':'Connecting...','正在等待玩家...':'Waiting for players...','正在等待开局...':'Waiting to start...',
  '正在等待选择...':'Waiting for the choice...','正在等待发牌…':'Waiting for the deal…','提交中…':'Sending…','正在等待房主响应...':'Waiting for the host...',
  '选：跑两次':'Picked: twice','选：跑一次':'Picked: once','选择中…':'Choosing…','思考中':'Thinking','买入待生效':'Buy-in pending',
  '{name} 的资料':"{name}'s profile",'全下':'All in','底池':'Pot','小盲':'Small blind','大盲':'Big blind',
  '等待':'Waiting','发牌':'Dealing','翻牌前':'Preflop','翻牌':'Flop','转牌':'Turn','河牌':'River','结算':'Showdown',
  '松凶，出手大。':'Loose and aggressive; bets big.','偏紧，求稳。':'Tight; plays it safe.','凶，难以捉摸。':'Aggressive and hard to read.',
  '土豪，爱玩。':'Big spender; loves to play.','稳健，深藏不露。':'Solid; keeps it hidden.','超松超凶。':'Very loose, very aggressive.',
  '您仍在游戏中。要退出牌桌，您将直接弃牌。':"You're still in the hand. Leaving the table folds it.",
  '超时牌桌':'Overtime table','该牌桌将在 12:05AM 被强制结束。届时您将会被弃牌，但下注的筹码将被退回。':
    'This table will be closed at 12:05 AM. Your hand will be folded then, but your bets will be returned.',
  // your seat: betting, money, waiting
  '过牌':'Check','过牌/弃牌':'Check/Fold','跟任何注':'Call any',
  '牌局已变化，请重新选择操作。':'The hand has moved on. Choose again.','请输入有效的整数金额。':'Enter a whole number.',
  '当前不能再加注。':"You can't raise now.",'最多到 {n}（All in）。':'At most {n} (all in).','最少到 {n}。':'At least {n}.',
  '确认 Fold':'Confirm Fold','确认 All in {n}':'Confirm All in {n}','确认 Call {n}':'Confirm Call {n}','确认 Raise {n}':'Confirm Raise {n}',
  '弃掉这一手牌':'Give up this hand','本次投入 {n} · 本轮合计 {t}':'Putting in {n} · {t} this round','找零 {c}':'change {c}',
  '下注 {n} · 找零 {c}':'{n} · change {c}','加注到（Custom 自定义金额）':'Raise to (custom amount)','加注金额':'Raise amount',
  '提前操作':'Pre-actions','继续游戏':'Next hand','请等待下一轮。':'Wait for the next hand.','您已弃牌。':'You folded.','您已 All in。':"You're all in.",
  '跑一次':'Run it once','跑两次':'Run it twice','离座':'Leave seat','表情':'Emoji','发表情':'Send an emoji',
  '买入筹码以开始。':'Buy chips to start.','撤回一枚 {d}':'Take back one {d}','点击筹码以下注，再次点击以撤回。':'Tap chips to bet; tap again to undo.',
  '未开始下注。':'No bet yet.','{d} 面值，剩 {n} 枚':'{d} chips, {n} left',
  '整理':'Tidy','整理筹码':'Tidy chips','先凑 白10 红6 蓝6，其余换成绿25':'10 white, 6 red and 6 blue first; the rest in green 25s',
  '自动整理筹码':'Auto-tidy chips','买入或取出':'Buy in or cash out','拖动滑块以调整买入或取出金额。':'Drag the slider to set the amount.',
  '可用余额 {n}':'Available {n}','买入 {n}':'Buy in {n}','取出 {n}':'Cash out {n}',
  '买入 {n} 筹码将于本局结束后执行。':'Buying in {n} chips when this hand ends.','取出 {n} 筹码将于本局结束后执行。':'Cashing out {n} chips when this hand ends.',
  '买入 {n} 筹码已执行。({s}s)':'Bought in {n} chips. ({s}s)','取出 {n} 筹码已执行。({s}s)':'Cashed out {n} chips. ({s}s)',
  '筹码不足 {n}，不能退一手。':"Fewer than {n} chips: you can't cash out a buy-in.",
  '你已被房主请出这个房间。':'The host removed you from this room.','正在等待座位...':'Waiting for a seat...','取消（退回这一手）':'Cancel (refund the buy-in)',
  '{n} 人在座':'{n} seated','已满 10 人，可以先排队':'Full (10); you can join the queue','牌局进行中，买入后这一手结束入座':"A hand is on; you'll sit down when it ends",
  '买一手并入座 +{n}':'Buy in and sit down +{n}','{who} 申请买一手 +{n}':'{who} asks to buy in +{n}','拒绝':'Decline','同意':'Approve',
  // 记录 (records)
  '我的统计':'My stats','人机模式累计 · 存在这张牌桌':'Bot games, all hands · kept at this table','人机模式累计 · 存在本机':'Bot games, all hands · kept on this device',
  '本房间':'This room','打了几手':'Hands played','主动跟注或加注':'calls or raises by choice','翻前加注':'Preflop raises','赢了几手':'Hands won',
  '最大底池':'Biggest pot','本房间盈亏':'Net in this room','清空我的统计':'Clear my stats','打完一手就有数据了。':'Stats appear after a hand.',
  '全桌统计':'Table stats','这一桌':'This table','入池':'VPIP','加注':'PFR','赢':'Won','确认清空？':'Clear them?',
  '邀请朋友':'Invite friends','复制链接':'Copy link','已复制':'Copied','朋友打开链接、留个名字就能进来，不需要注册账号。':'Friends open the link and leave a name to join. No sign-up needed.',
  '玩家§section':'Players','{n} 在座':'{n} seated','{n} 排队':'{n} waiting','上限 10':'max 10','未买入':'Not bought in','离座中':'leaving','排队':'waiting',
  '已请出':'removed','允许回来':'Let back in','请出':'Remove','确认请出？':'Remove them?','已离桌':'left',
  '你是房主。发牌在 Verve 服务器上进行，你离开或锁屏都不影响牌局。':
    "You're the host. The cards are dealt on the Verve server, so leaving or locking your screen doesn't stop the game.",
  '发牌在 Verve 服务器上进行。你的底牌只发给你，别人（包括房主）都看不到。':
    'The cards are dealt on the Verve server. Your hole cards go only to you; nobody else, the host included, can see them.',
  '账本':'Ledger','一手 {n}':'Buy-in {n}','买入':'In','退出':'Out','桌上':'On table','盈亏':'Net','还没有人买入。':'No one has bought in yet.','合计':'Total',
  '买入 / 退出记录':'Buy-ins and cash-outs','{n} 笔':'{n} entries','买一手':'Buy-in','退一手':'Cash-out','离桌带走':'Left with',
  '还没有买入或退出记录。':'No buy-ins or cash-outs yet.','牌局记录':'Hand log','最近 {n} 条':'last {n}',
  '洗牌用 crypto.getRandomValues 做无偏 Fisher–Yates，每手重洗一副 52 张。练习模式在你的浏览器里洗牌发牌；正常模式和好友房间由 Verve 服务器（Cloudflare）洗牌发牌，每位玩家的底牌经加密连接只发给本人，其他人（包括房主）的浏览器里都没有，摊牌时才亮出来。轮到真人时限 45 秒，超时自动过牌或弃牌。':
    "Cards are shuffled with crypto.getRandomValues (an unbiased Fisher–Yates), a fresh 52-card deck every hand. Practice deals in your browser; regular tables and friends rooms are dealt by the Verve server (Cloudflare), and each player's hole cards go over an encrypted connection to that player alone, in nobody else's browser (the host's included) until the showdown. A player has 45 seconds a turn; after that they check or fold automatically.",

  // ---- what the dealer writes into the table's state (tx)
  '高牌':'High card','一对':'Pair','两对':'Two pair','三条':'Three of a kind','顺子':'Straight','同花':'Flush','葫芦':'Full house',
  '四条':'Four of a kind','同花顺':'Straight flush','皇家同花顺':'Royal flush',
  '至少需要两位有筹码的玩家才能开局':'At least two players with chips are needed to start',
  '超时牌桌已强制结束，下注已退回':'The overtime hand was called off; every bet went back',
  '全下！亮牌，选择跑一次还是跑两次':'All in! Cards up: run it once or twice?','所有人同意，跑两次':'Everyone agreed: running it twice',
  // the bots' lines (talk.js)
  '这牌我都不好意思看':"Can't even look at this",'溜了溜了':"I'm out",'你们玩，我看戏':"You play, I'll watch",'手气留给下一把':'Saving my luck',
  '打扰了':'Excuse me','算你狠':'You win this one',
  '过～':'Check~','我先看看':'Let me see first','让一让':'After you','稳住':'Steady',
  '跟就跟，谁怕谁':"Call. Who's scared?",'我就看一眼':'Just a peek','不信你有':"I don't believe you",'来都来了':'Might as well','我是来交朋友的':"I'm here to make friends",
  '加点料':'Spicing it up','你敢跟吗？':'Dare to call?','我牌很大（真的）':'Big hand (really)','今天手热':"I'm on fire today",'不服来战':'Come at me',
  '梭哈！':'All in!','全部家当都在这了':"Everything I've got",'不装了，摊牌了':'No more acting','要么吃肉要么回家':'Feast or go home','信我一次':'Trust me once',
  '谢谢老板':'Thanks, boss','承让承让':'Too kind','这就是实力':'Pure skill','晚饭有着落了':"Dinner's sorted",'运气也是实力':'Luck is skill too',
  '我的筹码…':'My chips…','重来重来':'Again, again','今天不宜打牌':'Not my day','我去充个值':'Topping up','这不科学':'This makes no sense',
  '你别得意':"Don't get cocky",'就这？':'That all?','下把见真章':'Next hand, for real',
  '跟！钱不是问题':"Call! Money's no issue",'我就喜欢看牌':'I love seeing cards','来都来了，跟':'Might as well, call','小钱，跟':'Pocket change, call',
  '你下多少我都跟':"I'll call anything",'看看再说':"Let's see",'先看牌':'Cards first','我说白了':'Let me be blunt',
  '有钱就是任性':'Money talks','早说了我运气好':'Told you, lucky me','我就知道你在诈唬':'Knew you were bluffing','没事，我家有矿':"No worries, I'm loaded",
  '再来两手！我有的是钱':'Two more! I have money','充值成功，继续':'Topped up, go on','买两手，接着奏乐接着舞':'Two buy-ins. Music on!',
  '这牌不打':'Not playing this','下一把再来':'Next one','要么不玩，要么玩大的':'Go big or go home','全下，来吧':'All in, come on',
  '按计划来':'Right on plan','打的就是这种池子':'My kind of pot','跟，看你下一枪':"Call. Let's see your next shot",
  '加倍！':'Double it!','翻前就是要加倍':'Preflop, I double','牌好，下大注':'Good cards, big bet','不让你便宜看牌':'No cheap looks','把池子做大':'Building the pot',
  '其实我能赢':'I would have won','看看':'Let me see','先看一张':'One card first','看牌':'Check','加一点点':'Just a little','小加一手':'A small raise',
  '我早就看穿你了':'I read you all along','这就是读牌':"That's reading people",'要不是运气，我每把都赢':"Luck! I'd win them all",'这种牌你也跟？':'You called with that?',
  '这把是真的':'This one is real','我有牌':'I have it','跟一下':'Call','慢慢来':'Slowly now','等你很久了':'Been waiting for you',
  '信我，我有':'Trust me, I have it','这把我认真的':"I'm serious this time",'我从不诈唬':'I never bluff','我说了我有':'Told you I had it','嘿嘿':'Hehe',
  '这次算你赢':'You win this time',
  '先 limp 一下':'Limp first','我看看':'Let me see','你在偷吧？跟':'Stealing? Call','过':'Check','打大一点':'Bigger','这个池子我要了':'This pot is mine',
  '全下，开牌吧':'All in, show them','运气好':'Lucky','大池子就是要赢':'Big pots are for winning','再来一个买入':'Another buy-in',
  '你没那么强':"You're not that strong",'加注，你怎么办？':'Raise. Now what?','再来一枪':'One more barrel','我觉得你在诈唬':"I think you're bluffing",
  '跟，我不信':"Call. Don't buy it",'全下，你敢跟吗？':'All in. Dare to call?','这把让你':'Yours this time','承让':'Too kind','下一手再来':'Next hand',
};

// A seat's last action: [the Chinese, its English on the seat, the verb for a log line '<who> <verb>']
export const EN_ACTS=[
  [/^弃牌$/,'Fold','folds'],
  [/^过牌$/,'Check','checks'],
  [/^跟注 ([\d,]+)$/,'Call $1','calls $1'],
  [/^全下 ([\d,]+)（Raise）$/,'All in $1 (raise)','raises all in to $1'],
  [/^全下 ([\d,]+)$/,'All in $1','goes all in for $1'],
  [/^Raise 到 ([\d,]+)$/,'Raise to $1','raises to $1'],
  [/^小盲 ([\d,]+)$/,'SB $1','posts the small blind, $1'],
  [/^大盲 ([\d,]+)$/,'BB $1','posts the big blind, $1'],
  [/^未买入$/,'Not bought in',null],
];

// The results and the log. A name is passed through as it is: a bot's, or a person's @@uid@@ (names() fills it in).
const POTS={'主池':'the main pot','底池':'the pot'};
const pot=p=>POTS[p]||p.replace(/^边池(\d+)$/,'side pot $1');
const run=r=>r==='第一次 · '?'Run 1 · ':r==='第二次 · '?'Run 2 · ':'';
const hands=(s,tx)=>s.split(' / ').map(tx).join(' / ');
export const EN_RULES=[
  [/^买一手 \+([\d,]+) 就开始发牌$/,m=>`Buy in +${m[1]} to start`],
  [/^等待玩家：已有 (\d+) 人买入，满 (\d+) 人自动开局$/,m=>`Waiting for players: ${m[1]} bought in; the game starts at ${m[2]}`],
  [/^(.+) 赢得 ([\d,]+)，其他人都弃牌了$/,m=>`${m[1]} wins ${m[2]}; everyone else folded`],
  [/^(第一次 · |第二次 · )?(.+) (平分|赢得)(主池|底池|边池\d+) ([\d,]+) · (.+)$/,
    (m,tx)=>`${run(m[1])}${m[2].split('、').join(', ')} ${m[3]==='平分'?'split':'wins'} ${pot(m[4])}, ${m[5]} · ${hands(m[6],tx)}`],
  [/^(.+) 收回未被跟的 ([\d,]+)$/,m=>`${m[1]} takes back the uncalled ${m[2]}`],
  [/^第 (\d+) 手 · (\d+) 人 · 庄位 (.+)$/,m=>`Hand ${m[1]} · ${m[2]} players · dealer ${m[3]}`],
  [/^(第一次 )?(翻牌|转牌|河牌)：(.+)$/,(m,tx)=>`${m[1]?'Run 1 · ':''}${tx(m[2])}: ${m[3]}`],
  [/^第二次：(.+)$/,m=>`Run 2: ${m[1]}`],
  [/^(.+) 亮牌 (.+) · (.+)$/,(m,tx)=>`${m[1]} shows ${m[2]} · ${hands(m[3],tx)}`],
  [/^(.+) 离开了座位$/,m=>`${m[1]} left the seat`],
  [/^(.+) 入座$/,m=>`${m[1]} sat down`],
  [/^(.+) 买一手 ([\d,]+)$/,m=>`${m[1]} buys in ${m[2]}`],
  [/^(.+) 退一手 ([\d,]+)$/,m=>`${m[1]} cashes out ${m[2]}`],
  [/^(.+) 离桌带走 ([\d,]+)$/,m=>`${m[1]} leaves with ${m[2]}`],
  [/^(.+) 申请买一手（等房主同意）$/,m=>`${m[1]} asks to buy in (waiting for the host)`],
  [/^房主同意 (.+) 买一手$/,m=>`The host let ${m[1]} buy in`],
  [/^房主拒绝了 (.+) 的买入$/,m=>`The host turned down ${m[1]}'s buy-in`],
  [/^房主请 (.+) 离开了房间$/,m=>`The host removed ${m[1]} from the room`],
  [/^房主允许 (.+) 重新加入$/,m=>`The host let ${m[1]} back in`],
];
