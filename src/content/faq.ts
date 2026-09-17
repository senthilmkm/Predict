/**
 * In-app FAQ — plain English Q&A for Settings.
 * Native UI only (not HTML). Keep answers aligned with live product behavior.
 */
import { supportContactEmail } from '../config/appMeta';

export type FaqTable = {
  headers: string[];
  rows: string[][];
};

export type FaqItem = {
  id: string;
  q: string;
  a: string;
  table?: FaqTable;
};

export type FaqCategory = {
  id: string;
  title: string;
  items: FaqItem[];
};

export function getFaqCategories(): FaqCategory[] {
  const email = supportContactEmail();
  return [
    {
      id: 'what',
      title: 'What Predict is',
      items: [
        {
          id: 'what-is-predict',
          q: 'What is Predict?',
          a:
            'Predict is an iPhone app for Kalshi 15-minute prediction markets.\n\n' +
            'It watches live price vs the contract strike, applies your cushion (a dollar buffer), and shows a lean: YES, NO, or skip.\n\n' +
            'You can get alerts, turn on Auto-trade so Cloud Run may place orders on a schedule, and — when Last signals Buy / Sell is On — tap Buy or Sell on Home so Cloud Run places now.\n\n' +
            'Example: Gold strike $2,650, your cushion is $7, live gold is $2,660. Gap is $10, which is more than $7, so the lean can be YES.',
        },
        {
          id: 'who-owns-account',
          q: 'Does Predict hold my Kalshi money?',
          a:
            'No. Predict never holds your cash. Trades go to your own Kalshi account with your API key.\n\n' +
            'Your Kalshi cash and open contracts stay at Kalshi. Predict only sends orders when Auto-trade or Protect money is On and the rules pass, or when you tap Buy / Sell on Home (if that feature is On).',
        },
        {
          id: 'what-markets',
          q: 'What markets does Predict trade?',
          a:
            'Only Kalshi 15-minute up/down contracts for the assets on the Cushions tab. Predict does not trade hourly, daily, or other longer Kalshi events. There is no 15-minute forex on Kalshi right now, so those pairs are not listed.\n\n' +
            'Crypto (24/7): BTC, ETH, SOL, DOGE, XRP, BNB, HYPE, NEAR, ZEC. HYPE, NEAR, and ZEC start Off on Cushions.\n' +
            'Commodities: Gold, Silver, WTI, Natural Gas, Copper. Follow Kalshi 15-minute books, including Friday night after CME futures close. If Kalshi has no open contract, Home shows no market.\n' +
            'US indexes: S&P 500, Nasdaq 100. Weekdays about 9:30 AM–4:00 PM ET only.\n\n' +
            'A new 15-minute window starts every quarter hour (10:00, 10:15, 10:30) only while Kalshi is listing that book. Closed hours show skip on Home — that is not a missing market.',
        },
        {
          id: 'what-is-lean',
          q: 'What is a “lean”?',
          a:
            'A lean is Predict’s reading of this 15-minute contract, after your cushion.\n\n' +
            'YES = live price is far enough above the strike.\n' +
            'NO = live price is far enough below the strike.\n' +
            'Skip = gap is inside your cushion, the market is closed, or a risk rule blocked a buy.\n\n' +
            'A lean is research, not a promise. It is not an order by itself.',
        },
        {
          id: 'what-is-cushion',
          q: 'What is a cushion?',
          a:
            'The extra distance live price must be past the strike before Predict calls YES or NO. Larger cushion = fewer, stricter signals.\n\n' +
            'Example: BTC default cushion is $175. If live is only $80 above the strike, that is not a YES yet.\n\n' +
            'Change cushions on the Cushions tab. You can also turn an asset off there without changing Risk.',
        },
        {
          id: 'what-is-gap',
          q: 'What is the gap on Home?',
          a:
            'Gap is the dollar distance between the live price and the strike. It is always a positive number. It does not by itself say which way live is.\n\n' +
            '▲ live over strike.\n' +
            '▼ live under strike.\n\n' +
            'Those marks stay gray. They are not win or loss.\n\n' +
            'If you already hold that 15-minute window, the line switches to “with you” (green) or “against you” (red) so you know whether the same gap is still on your side.',
        },
      ],
    },
    {
      id: 'disclaimer',
      title: 'Risk, disclaimer & legal',
      items: [
        {
          id: 'does-it-guarantee',
          q: 'Does Predict guarantee profits?',
          a:
            'No. Trading involves risk of loss. Predict does not guarantee profits or successful trades — whether you use alerts, Auto-trade, Home Buy / Sell taps, or any mix.\n\n' +
            'Past results on Home, Dashboard, or History do not predict the next contract. You can lose some or all of the money you risk on Kalshi.',
        },
        {
          id: 'is-this-advice',
          q: 'Is this financial or trading advice?',
          a:
            'No. Nothing in Predict is financial, investment, legal, or trading advice.\n\n' +
            'Predict is not a broker, investment adviser, or money manager. It does not owe you a fiduciary duty. You decide whether to use alerts, Auto-trade, Home Buy / Sell, and Protect money.',
        },
        {
          id: 'who-is-liable',
          q: 'Who is responsible if I lose money?',
          a:
            'You are. That includes:\n' +
            '• trades you place yourself on Kalshi after seeing a Predict alert\n' +
            '• trades Cloud Run places when Auto-trade is On\n' +
            '• trades Cloud Run places when you tap Buy or Sell on Home\n' +
            '• early exits when Protect money is On\n\n' +
            'The app owner is not liable for your losses. The full wording is in Settings → Legal, and on the public Risk Disclaimer page.',
        },
        {
          id: 'affiliated-kalshi',
          q: 'Is Predict part of Kalshi?',
          a:
            'No. Predict is an independent software tool. It is not affiliated with, endorsed by, sponsored by, or associated with Kalshi, Inc.\n\n' +
            'You need your own Kalshi account. Kalshi’s rules, fees, and settlement still apply.',
        },
        {
          id: 'api-outages',
          q: 'What if Kalshi, the network, or Cloud Run has a problem?',
          a:
            'Orders need Kalshi’s API, price feeds, your phone or Cloud Run, and the internet.\n\n' +
            'If any of those lag, halt, or fail, a buy or sell may miss, delay, partial-fill, or fill at a worse price. Predict’s owner is not responsible for losses from downtime, rate limits, slippage, market halts, feed errors, or a locked/offline phone.\n\n' +
            'Example: a YES buy is sent as IOC and nobody is offering that price — that is an IOC miss. No fill, no position.',
        },
        {
          id: 'protect-sell-disclaimer',
          q: 'Does Protect money (early sell) guarantee I will be saved?',
          a:
            'No. Protect money tries to sell early when the lean flips against you. It does not guarantee a successful exit, a small loss, or that you keep capital.\n\n' +
            'The sell may fail, delay, partial-fill, or fill worse than you hoped because of traffic, API delay, a thin book, wide spreads, a fast price jump, or time running out near expiry. You can still lose the full amount you spent on that contract.\n\n' +
            'Example: you bought YES, wait-after-fill is 45s, then gold drops through your cushion the other way. Cloud Run sends an IOC sell. If that sell misses, you still hold YES until settlement.',
        },
        {
          id: 'manual-from-alerts',
          q: 'If I only use alerts and trade myself on Kalshi, am I still responsible?',
          a:
            'Yes. An alert is not an order. If you tap into Kalshi and place a trade because Predict pinged you, that trade and its P&L are yours.\n\n' +
            'If Home shows Buy / Sell and you tap it, that is also your order (Cloud Run places it). Review the lean yourself before you tap.',
        },
        {
          id: 'age-and-legal',
          q: 'Who is allowed to use Predict?',
          a:
            'Predict is intended for people who are at least 18 (or the legal age where you live) and who live where prediction-market trading is legal.\n\n' +
            'You must also be allowed to hold a Kalshi account under Kalshi’s own rules.',
        },
        {
          id: 'taxes',
          q: 'Who handles taxes?',
          a:
            'You do. Predict does not file taxes for you. Any gains or losses on your Kalshi account are yours to report under your local, state, and federal rules.',
        },
        {
          id: 'where-legal-text',
          q: 'Where is the full legal disclaimer?',
          a:
            'Settings → Legal (tap to expand). You also accepted it during first-launch onboarding.\n\n' +
            'The same ideas appear on the public Risk Disclaimer, Terms, and Privacy pages linked from Subscription → Manage. Settings → Account shows when this phone last recorded acceptance.',
        },
      ],
    },
    {
      id: 'subscription',
      title: 'Subscription & trial',
      items: [
        {
          id: 'what-does-pro-cost',
          q: 'What does Predict Pro cost?',
          a:
            'Predict Pro is $29.99 per month through Apple, with a 7-day free trial if you have not already used the trial on this Apple ID.\n\n' +
            'Payment is charged to your Apple ID. It renews monthly unless you cancel at least 24 hours before the period ends. Manage or cancel in Apple Subscriptions (Settings → Subscription → Manage).',
        },
        {
          id: 'trial-reset',
          q: 'If I delete the app, do I get another free trial?',
          a:
            'Usually no. Access is tied to your Apple ID. Uninstalling does not reset a used trial or a paid subscription.\n\n' +
            'After reinstall, tap Restore Purchases in Subscription → Manage.',
        },
        {
          id: 'restore-purchases',
          q: 'I paid but the app says I’m not subscribed. What should I do?',
          a:
            'Open Settings → Subscription → Manage → Restore Purchases. Use the same Apple ID that bought Predict Pro.\n\n' +
            'Then tap Refresh status. If it still fails, email support and say you already restored — do not send your Kalshi private key.',
        },
      ],
    },
    {
      id: 'alerts-autotrade',
      title: 'Alerts vs Auto-trade',
      items: [
        {
          id: 'alerts-vs-auto',
          q: 'What’s the difference between Signal alerts and Auto-trade?',
          a:
            'Signal alerts On = you can be notified when a lean appears. No order is placed just because an alert fired.\n\n' +
            'Auto-trade On = Cloud Run may place real Kalshi buy orders when a path (Cushion lean, Last-minute, Pair lock, and the others) and Risk rules pass. Face ID is required to turn this On.\n\n' +
            'Home Buy / Sell (when the Last signals Buy / Sell flag is On) = you tap to place now, even if Auto-trade is Off. The tap uses Settings → Risk → Home Buy. Shared limits apply to both paths.\n\n' +
            'They are independent. Example: alerts On + Auto-trade Off = research pings, plus optional Home taps if the buttons are shown.',
        },
        {
          id: 'home-buy-sell',
          q: 'What does tapping Buy or Sell on Home do?',
          a:
            'When Last signals Buy / Sell is On, Home shows one Home Buy / Sell block. Buy YES / Buy NO is a Home tap only; it appears only if Home Buy gates would pass (the same gates Cloud uses on a tap). If the row says ask too rich, too little time left, and so on, there is no Buy button. Sell is in that same block when you already hold that 15-minute window.\n\n' +
            'If Auto-trade is On and its Risk tab also passes, Cloud Run can still buy that same lean on the worker tick — even while Home shows Buy. Shared caps apply to both paths (max open, max trades / day, max trades / asset / 15m window, daily loss). If the 15m window cap is 1, the first fill (Home or Auto) uses the slot.\n\n' +
            'One tap tells Cloud Run to place now. The phone never talks to Kalshi. There is no confirm sheet.\n\n' +
            'Purpose: trade without Auto-trade, or take a contract you see while the app is open even if Auto-trade is On.\n\n' +
            'A tap uses Settings → Risk → Home Buy: $ per trade, min/max $, minutes left, minutes elapsed, max entry ask, time in force, and chase. Shared limits (max open, trades/day, 15m window, daily loss) and cushions apply to both Home Buy and Auto-trade. Auto-trade uses the Auto-trade tab, including Protect money.\n\n' +
            'Last signals shows one extra line. If the same coin is on more than one path, that line names who is holding or who already filled this window, and who sits out (for example “Spike fade already filled this window — Last-minute sits out”). Otherwise a Home Buy skip stays on that YES/NO row (Buy is hidden). Auto-trade skips are not shown on that row. If there is no Home skip and no Buy/Sell, Auto-trade’s last skip/place can show.\n\n' +
            'Success shows a gold “Gold buy success” chip flying up from the button — not a popup. Failures show an error popup.\n\n' +
            'You can lose the full amount of that order. GTC can rest on the book. IOC can miss. If the Admin flag Last signals Buy / Sell is Off, buttons disappear and Cloud rejects taps.',
        },
        {
          id: 'home-sell-at',
          q: 'What is Home Buy “Sell at” %?',
          a:
            'Settings → Risk → Home Buy → Sell at. Dump when the live held-side mark is at least this % above your fill (0 = Off; default Off). Steps 5–100.\n\n' +
            'Uses the same Protect wait-after-fill / grace. Independent of Protect money lean-flip — it can dump on mark profit even if Protect is Off.',
        },
        {
          id: 'need-keys-for-alerts',
          q: 'Do I need a Kalshi API key for alerts only?',
          a:
            'No. Alerts can run without keys. Allow notifications during setup (or later in iOS Settings) if you want pings when Predict is closed.\n\n' +
            'You need a saved Key ID + private key PEM for Auto-trade, Home Buy / Sell taps, Protect money sells, settlement checks, and Kalshi balances on Home. Tap Test connection after you save keys.',
        },
        {
          id: 'kill-switch',
          q: 'What does the header kill switch do?',
          a:
            'It is the red “!” panic icon in the top-right header (left of Export). Tap confirms, then turns Auto-trade Off right away on this phone and syncs that Off state to Cloud Run, so new automatic buys should stop. It also hides Home Buy / Sell.\n\n' +
            'It does not turn Protect money Off. If Protect money is still On, Cloud Run may still try to sell open trades.\n\n' +
            'Cloud Run still settles fills you already have and can still write Trade won / Trade lost.\n\n' +
            'To stop new buys and early sells: Auto-trade Off, Last signals Buy / Sell off (or Kill Switch), and turn Protect money Off under Settings → Risk → Auto-trade.',
        },
        {
          id: 'phone-in-background',
          q: 'Do I need to keep the app open?',
          a:
            'For Auto-trade and Protect money: no. Those run 24/7 on Cloud Run if they are On and your keys are saved. The phone does not need to stay on screen.\n\n' +
            'The phone’s own lean polling pauses when Predict is in the background, so Home numbers can look stale until you reopen. Cloud Run keeps working.\n\n' +
            'Example: you lock the phone at 2:00 AM. A Gold lean can still buy (if Auto-trade is On) and can still protect-sell (if that switch is On).',
        },
      ],
    },
    {
      id: 'cloud',
      title: 'Cloud Run vs this phone',
      items: [
        {
          id: 'what-is-cloud-run',
          q: 'What is Cloud Run doing?',
          a:
            'Google Cloud Run is Predict’s always-on server. On a short tick it can:\n' +
            '• send lean / fill / protect-sell / trade-result / IOC-miss / daily-loss push sounds (so the phone does not ding twice)\n' +
            '• place Auto-trade buys when Auto-trade is On\n' +
            '• place a Home Buy / Sell when you tap (if Last signals Buy / Sell is On)\n' +
            '• place Protect money sells when that switch is On\n' +
            '• record fills and settlements on your user in Firestore (settlements continue after Auto-trade Off if keys are saved)\n\n' +
            'Your Home Buy numbers, Auto-trade numbers, shared limits, and asset on/off flags are stored with your user so the server uses the same rules as Settings.',
        },
        {
          id: 'who-sells',
          q: 'Does the phone ever buy or sell?',
          a:
            'No. The phone never talks to Kalshi. Auto-trade buys, Home Buy / Sell taps, and Protect money sells are placed by Cloud Run only.\n\n' +
            'A Home tap still spends real money — Cloud Run places the order. Protect money still runs 24/7 on Cloud Run even if Auto-trade (new buys) is Off — as long as the Protect money switch is On and keys are saved.',
        },
        {
          id: 'user-id',
          q: 'What is Account & Cloud Identity?',
          a:
            'That is the User ID this install uses on the server (usually your Apple Sign In subject). It matches the Admin Portal user so settings, trades, and pushes stay on the same account.\n\n' +
            'It is not your Kalshi login and not your API private key.',
        },
      ],
    },
    {
      id: 'hours',
      title: 'Hours, windows & assets',
      items: [
        {
          id: '15m-window',
          q: 'How do 15-minute windows work?',
          a:
            'Each asset has a new contract about every 15 minutes. Predict only looks at the current window.\n\n' +
            'Example: 10:00–10:15 Gold. After 10:15 that contract settles YES or NO, and a new 10:15–10:30 contract starts. Your “Max trades / asset / 15m window” count resets on the new ticker.',
        },
        {
          id: 'when-markets-closed',
          q: 'Why does Home say an asset is closed?',
          a:
            'Crypto can run 24/7. Other groups follow exchange hours (Eastern Time):\n' +
            '• US indexes: about 9:30 AM–4:00 PM ET, weekdays\n' +
            '• Gold, oil, and other Kalshi 15-minute commodities: poll whenever Kalshi lists a live book, including Friday night\n\n' +
            'Home may show a one-line weekend/holiday banner for stocks and forex. Tap the i for hours. Crypto and commodities still lean when Kalshi has a book.',
        },
        {
          id: 'turn-off-asset',
          q: 'How do I pause one asset?',
          a:
            'Open the Cushions tab, find the asset, and turn it off. Risk settings stay the same. Cloud Run will not scan that asset until you turn it back on.\n\n' +
            'You can also turn a whole category off with the category switch.',
        },
      ],
    },
    {
      id: 'risk',
      title: 'Risk settings (buys)',
      items: [
        {
          id: 'where-risk',
          q: 'Where do I change trade size and limits?',
          a:
            'Settings → Risk → Show. Shared limits sit above the tabs. Then pick Home Buy or Auto-trade for that path’s size and timing. Tap the i next to Risk for a label-by-label guide.\n\n' +
            'Defaults: $5 per trade, max $5, min $1, max 5 open positions, 100 new buys per day, 1 buy per asset per 15-minute window, $50 daily loss stop, wait 2 minutes after the window opens, need 2 minutes left, max ask $0.90, Auto-trade IOC, Home Buy IOC, chase $0.02, Smart buy On (min extra chance $0.08), Protect money Off. Size/timing start the same on both Risk tabs until you change one.',
        },
        {
          id: 'window-cap',
          q: 'What is Max trades / asset / 15m window?',
          a:
            'How many new buys of the same asset Cloud Run may place in one 15-minute contract. Default is 1 (range 1–5).\n\n' +
            'Example: Gold cap 1 → one Gold buy this window, then wait for the next Gold contract. Cap 2 → a second Gold buy is allowed in the same window if lean, cushion, time, and max-open still pass (typical after a protect-sell closed the first).\n\n' +
            'Only filled new buys count. A protect-sell does not use a slot. A missed IOC does not use a slot. This is not the same as Max trades / day (that is all assets, all day).',
        },
        {
          id: 'max-open-and-day',
          q: 'What are max open positions, max trades / day, and daily loss stop?',
          a:
            'Max open = how many unsettled Predict trades you may hold at once. Example: 1 means no new buy until the open one settles or is protect-sold.\n\n' +
            'Max trades / day = filled buys today across all assets. A later sell of that same fill is not a second trade. IOC misses do not count. Extra Last-minute clips, Step buy lots, and a Pair lock hedge each count as their own filled buy.\n\n' +
            'Daily loss stop = if today’s locked-in losses reach this dollar amount (default $50), new buys stop for the day. It is a brake, not a reverse of past losses.',
        },
        {
          id: 'timing-and-ask',
          q: 'Why did it skip with “too early,” “too little time,” or “size too small”?',
          a:
            'Each path has its own minutes left, minutes elapsed, and max entry ask under Settings → Risk.\n\n' +
            'If Buy is showing, Last signals uses the Home Buy tab (so Auto-trade’s “ask too rich” is not shown next to a tap that would still place).\n\n' +
            'Min minutes elapsed (default 2) = don’t buy in the noisy open for that path.\n\n' +
            'Min minutes left (default 2) = don’t buy in the last minutes for that path. These two buy-timing rules do not block Protect money sells.\n\n' +
            'Max entry ask (default $0.90) = don’t buy a very expensive ticket for that path.\n\n' +
            'Min $ / trade (default $1) = if the order would be smaller than this, it skips “size too small.” Shared caps (max open, trades/day, 15m window, daily loss) stop both paths.',
        },
        {
          id: 'tif-and-chase',
          q: 'What are IOC / FOK / GTC and chase above ask?',
          a:
            'Time in force is how long a buy stays on Kalshi.\n\n' +
            'Auto-trade uses Settings → Risk → Auto-trade. Home Buy uses Settings → Risk → Home Buy. Same three choices:\n' +
            '• IOC (default) = fill what you can now, cancel the rest\n' +
            '• FOK = fill all now or cancel all\n' +
            '• GTC = leave it working until filled or canceled\n\n' +
            'Most people keep IOC on these short windows. GTC on a Home tap can rest until the 15-minute window ends. Protect money sells and Home Sell taps always use IOC.\n\n' +
            'Chase above ask (default $0.02) is a tiny extra above the ask. Each path caps pay by that path’s max entry ask (max $0.99). Auto-trade chase is also protect-sell slippage.',
        },
        {
          id: 'risk-shared-vs-path',
          q: 'Which Risk settings are shared vs only Home Buy or Auto-trade?',
          a:
            'Shared (one Kalshi account, both paths):\n' +
            '• max open positions\n' +
            '• max trades / day\n' +
            '• max trades / asset / 15m window\n' +
            '• daily loss stop\n' +
            '• cushions and asset on/off (Cushions tab)\n\n' +
            'Home Buy tab only: $ per trade, min/max $, minutes left, minutes elapsed, max entry ask, time in force, chase. Used when you tap Buy on Home. Home Sell stays IOC; its slippage is Home Buy chase.\n\n' +
            'Auto-trade tab only: the same size/timing fields for Cloud’s scheduled buys, plus Smart buy (default On, min extra chance $0.08) and Protect money (early sell). Protect can still exit a fill that started as a Home Buy. Smart buy does not apply to a Home tap.\n\n' +
            'Home Buy / Sell on Last signals is the Home tap path. If Auto-trade is also On and its tab passes, the worker can buy that same lean as long as shared caps still have room (15m window, trades/day, max open, daily loss).\n\n' +
            'Last signals never shows both skips at once. If Home Buy would skip (ask too rich, timing, size, shared cap), Buy is hidden and that Home skip stays on the row. Auto-trade’s last skip/place shows only when there is no Home skip and no Buy/Sell button.',
        },
        {
          id: 'restore-risk',
          q: 'What do Restore shared limits and Restore this tab do?',
          a:
            'Settings → Risk → Show opens Shared limits plus Home Buy and Auto-trade tabs.\n\n' +
            'Restore shared limits resets max open, trades/day, 15m window, and daily loss stop.\n\n' +
            'Restore Home Buy / Restore Auto-trade resets only that tab’s size and timing (and Smart buy, Protect money, Cash out, Gold fade, TWAP lock, Last-minute, Step buy, Spike fade, Pair lock, and Cheap loop on Auto-trade). Cushions and keys are not wiped.',
        },
        {
          id: 'smart-buy',
          q: 'What is Smart buy on Auto-trade?',
          a:
            'Settings → Paths → Cushion lean. It is Off/On plus Min extra chance (default On, $0.08). Home Buy ignores it.\n\n' +
            'When On, Cushion lean still uses cushions, minutes, max ask, and shared caps. Then it also skips unless our guess is at least Min extra chance above the Kalshi ticket. The guess uses this window’s price path, time left, and how jumpy the price has been. Kalshi sets the ask; you do not type it.\n\n' +
            'Skip lines you may see: “ticket not a good deal,” “gap shrinking,” or “need a longer price path.”\n\n' +
            'Turn it Off to go back to cushion + risk only. It does not guarantee more wins or profits.',
        },
        {
          id: 'cushion-lean',
          q: 'What is Cushion lean?',
          a:
            'Settings → Paths → Cushion lean. This is the leftover Auto path: Cloud buys when the live gap is bigger than your Cushions $ and not yet Skip if gap ≥ cushion × (default 2.5×), and Smart buy, minutes, max ask, and shared caps pass. Default On.\n\n' +
            'Off = Cloud skips those gap>cushion buys only. Last-minute, Pair lock, Spike fade, Step buy, Cheap loop, Cash out, Gold fade, and TWAP lock keep their own switches.\n\n' +
            'Settings Auto-trade is the master. Off there stops every Auto path, including Cushion lean.\n\n' +
            'Missing on old phones = On, so nothing changes until you flip it. Protect money still works when Cushion lean is Off.',
        },
        {
          id: 'cushion-lean-max-gap',
          q: 'What does “Skip if gap ≥ cushion ×” mean?',
          a:
            'Settings → Paths → Cushion lean only. Home Buy ignores it.\n\n' +
            'Cushion lean buys when the live gap is above your Cushions $. This knob also skips when the gap is too stretched — at least X times that cushion (default 2.5×).\n\n' +
            'Example: BTC cushion $100 and 2.5× → buy only when gap is above $100 and at most $250. A $300 gap sits out.',
        },
        {
          id: 'cushion-lean-sell-at',
          q: 'What is Cushion lean “Sell at” %?',
          a:
            'Settings → Paths → Cushion lean → Sell at (when Cushion lean is On). Dump Auto fills when the live held-side mark is at least this % above your fill (0 = Off; default Off). Steps 5–100.\n\n' +
            'Uses the same Protect wait-after-fill / grace. Independent of Protect money lean-flip. Home Buy has its own Sell at knob.',
        },
      ],
    },
    {
      id: 'protect',
      title: 'Protect money (early sell)',
      items: [
        {
          id: 'protect-how',
          q: 'How does Protect money work?',
          a:
            'When On (Settings → Paths → Cushion lean), if you already hold a fill and the live lean flips strongly against you, Cloud Run sends an IOC sell after the wait-after-fill.\n\n' +
            'Default wait is 45 seconds so the first noisy ticks after a buy don’t instantly sell. After that wait, a sell can fire at any remaining time in the window — not only in the last minutes.\n\n' +
            'When Off (default), open trades ride until the 15-minute contract settles win or loss — unless Home Buy or Cushion lean Sell at % is set and the mark hits that profit.',
        },
        {
          id: 'protect-gap',
          q: 'What does “Sell when gap ≥ cushion ×” mean?',
          a:
            'How strong the opposite lean must be.\n\n' +
            '1.00× (default) = opposite gap at least your asset cushion.\n' +
            'Higher (1.50×) = harder to trigger.\n' +
            'Lower (0.75×) = easier to trigger.\n\n' +
            'Example: BTC cushion $175 and 1.00×. You hold YES. Sell if lean is NO and live is at least $175 below the strike.',
        },
        {
          id: 'protect-vs-sell-at',
          q: 'How is Protect money different from Sell at %?',
          a:
            'Protect money sells on a strong opposite lean after the wait. Sell at % (Home Buy and Cushion lean knobs) dumps when the held mark is that % above your fill.\n\n' +
            'Both share Protect’s wait-after-fill / grace. They are independent — Sell at can fire with Protect Off, and Protect can fire with Sell at Off.',
        },
      ],
    },
    {
      id: 'cashout',
      title: 'Cash out',
      items: [
        {
          id: 'cashout-how',
          q: 'What is Cash out?',
          a:
            'A separate Auto path (Admin must turn it On first). Settings → Risk → Auto-trade → Cash out.\n\n' +
            'Settings → Paths → Cash out. Checked assets use Cash out instead of Cushion lean. Size is this path’s $ per trade / min / max (default $5 / $1 / $5). Missing $ on an old phone seeds from Cushion lean $ so your live size does not jump. After that, Cushion lean $ no longer changes Cash out.\n\n' +
            'It buys when the gap is your Enter cushion % of the Cushions dollar (default 60%), the ask is at or under Max ask (default $0.82), and the book is tight. It then sells when the bid is up by Cash out bid minus max ask from what you paid (paid $0.82 → $0.88; paid $0.78 → $0.84). If the bid falls by Cash out stop below the fill (default 5¢), it sells to cut a full $0 loss. If the lean fully flips by a full cushion, it sells to get out. If none of those happen, the ticket settles $1 or $0 — no last-second dump.\n\n' +
            'Each path has its own Skip thin bid checkbox (default Off). See Skip thin bid in FAQ for what happens if the book is thin or unknown.\n\n' +
            'Home Buy and Cash out never share a ticker. Protect money does not sell Cash out lots.',
        },
        {
          id: 'cashout-admin',
          q: 'Why don’t I see Cash out on Risk?',
          a:
            'The Admin portal Feature configs switch “Cash out” is Off (default). When an admin turns it On, the block appears on Auto-trade. Bid check seconds (how often Cloud reads the bid after a fill) is also Admin-only.',
        },
      ],
    },
    {
      id: 'goldfade',
      title: 'Gold fade',
      items: [
        {
          id: 'goldfade-how',
          q: 'What is Gold fade?',
          a:
            'A separate Auto path (Admin must turn it On first). Settings → Paths → Gold fade. Default Off. Gold only.\n\n' +
            'Size is this path’s $ per trade / min / max (default $5 / $1 / $5). Missing $ on an old phone seeds from Cushion lean $ so your live size does not jump. After that, Cushion lean $ no longer changes Gold fade.\n\n' +
            'When the gap (live vs strike) is at most Max gap (default $3), Cloud buys the cheaper ticket if that ask is at or under Max cheap ask (default $0.50) and the book is tight. It then sells all contracts if the bid is up Take profit from what you paid (default 6¢), hits Gold fade stop (default 5¢), the bid pile is thinner than you hold (when this path’s Skip thin bid is On), minutes left hit Flatten (default 3), the window ends, or the gap blows a full Gold cushion against you.\n\n' +
            'This is not Cash out. Cash out buys the favorite on a large gap and does not dump at the bell. Fade buys the cheap side on a small gap and always flattens. Home, Auto, and Cash out never share a ticker with a Gold fade lot. Protect money does not sell fade lots.',
        },
        {
          id: 'goldfade-admin',
          q: 'Why don’t I see Gold fade on Risk?',
          a:
            'The Admin portal Feature configs switch “Gold fade” is Off (default). When an admin turns it On, the block appears on Auto-trade. Your Gold fade switch stays Off until you turn it on.',
        },
      ],
    },
    {
      id: 'twaplock',
      title: 'TWAP lock',
      items: [
        {
          id: 'twaplock-how',
          q: 'What is TWAP lock?',
          a:
            'A separate Auto path (Admin must turn it On first). Settings → Paths → TWAP lock. Default Off. BTC and ETH only.\n\n' +
            'Size is this path’s $ per trade / min / max (default $5 / $1 / $5). Missing $ on an old phone seeds from Cushion lean $ so your live size does not jump. After that, Cushion lean $ no longer changes TWAP lock.\n\n' +
            'Kalshi crypto 15m settles on a 60-second average of official CF Benchmarks prints in the last minute. TWAP lock buys Yes only when the running sum already wins even if every leftover second is $0 (banked ≥ strike × 60). Max ask default $0.96 (range $0.90–$0.97). Then it holds to $1 — no stop, fade, or dump.\n\n' +
            'Most windows do nothing. A true lock usually appears in the last 1–3 seconds, and only if the running average is already well above the strike. If Yes is 98–99¢, we skip. Missing a second or a bad book (when this path’s Skip thin bid is On) fails closed — no buy.\n\n' +
            'This is not Cash out and not Gold fade. While TWAP lock is On for BTC or ETH, Cloud will not Cash out or Auto-lean that coin — those paths would spend the window before a lock can appear. Home Buy is still a tap. Gold and other Cash out assets are unchanged. Protect money does not sell TWAP lock lots.',
        },
        {
          id: 'twaplock-admin',
          q: 'Why don’t I see TWAP lock on Risk?',
          a:
            'The Admin portal Feature configs switch “TWAP lock” is Off (default). When an admin turns it On, the block appears on Auto-trade. Your TWAP lock switch stays Off until you turn it on. Cloud also needs a proven CF Benchmarks 1-second feed before Admin should turn this On in production.',
        },
      ],
    },
    {
      id: 'lastminute',
      title: 'Last-minute',
      items: [
        {
          id: 'lastminute-how',
          q: 'What is Last-minute?',
          a:
            'A separate Auto path (Admin must turn it On first). Settings → Risk → Auto-trade → Last-minute. Default Off. Pick assets on that block; they must also be On in Cushions. Empty means no Last-minute buys.\n\n' +
            'Cloud watches 1s quotes from Watch start (default 150s / 2.5 minutes left). It does not buy at minute 13 on a 60–75¢ print. First clip is 1 contract only when Both still qualifies — favorite ≥ Both min, ≥ Both gap ahead, and live ask ≤ Entry ask. That usually appears in the last 60–90 seconds (First clip by, default 90s). Then clip ladder: every Ladder wait (default 2s), +Clip contracts/asset if it is still the favorite and ask is still ≤ Entry ask. Stop with Stop seconds left (default 10s) or a $1.00 ask.\n\n' +
            'Tune Watch start, First clip by, Stop, Ladder wait, Clip contracts/asset, Max clips/asset, Both min favorite, Both min gap, Sell if flip, Late ATR cushion, Entry ask, Side, and assets on Risk. Both sits out a 50/50 book. Hold to settlement unless Sell if flip is On — then a real opposite-side flip of that many cents (default Off; 10¢ is a real flip, not a 1¢ dip) sells only those lots and frees the clip slots.\n\n' +
            'Late ATR cushion (default On): in the final 60 seconds, when the chosen ask is at least High ask floor (default 88¢), Cloud also needs signed lead ≥ ATR × (default 1.25) using a 1‑minute ATR built from this window’s Kalshi live path when that path can be measured. Lead thinner than normal 1m noise → skip. Missing path does not block. Home Buy and Cushion lean ignore this.\n\n' +
            'This is not TWAP lock. There is no $0 leftover math. Last seconds can flip. You can lose the full entry ask.\n\n' +
            'Cash out and Auto already sit out the last minute, so Last-minute does not pull coins off those paths. Window cap 1 still applies: if Auto or Cash out already filled this coin this window, the first clip sits out. After that first Last-minute fill, ladder adds are extra (up to Max clips/asset). If TWAP lock is On for BTC/ETH, those two stay with TWAP. This path’s Skip thin bid applies (unknown book fails closed). IOC only.',
        },
        {
          id: 'lastminute-atr',
          q: 'What is Late ATR cushion?',
          a:
            'Settings → Paths → Last-minute only. In the final 60 seconds at a high ask (default ≥ 88¢), the lead to the strike must be at least ATR × (default 1.25) the asset’s 1‑minute Average True Range from this window’s live path.\n\n' +
            'Example: 1m ATR $0.08 and 1.25× → need $0.10 lead. A $0.03 lead at a 90¢ ask skips; a $0.12 lead can buy. If the 1m path cannot be measured, Last-minute does not skip for ATR.\n\n' +
            'Off = Last-minute skips this check. Home Buy and Cushion lean never use it.',
        },
        {
          id: 'lastminute-admin',
          q: 'Why don’t I see Last-minute on Risk?',
          a:
            'The Admin portal Feature configs switch “Last-minute” is Off (default). When an admin turns it On, the block appears on Auto-trade. Your Last-minute switch stays Off until you turn it on.',
        },
      ],
    },
    {
      id: 'step-buy',
      title: 'Step buy',
      items: [
        {
          id: 'what-is-step-buy',
          q: 'What is Step buy?',
          a:
            'A separate Auto path (Admin must turn it On first). Settings → Risk → Auto-trade → Step buy. Default Off. Pick assets on that block; they must also be On in Cushions. Empty means no Step buy buys.\n\n' +
            'After Start after minutes, if the live gap is at least Cushion % of that coin’s Cushions $ and the lean is YES or NO, Cloud buys Lot contracts at the live ask (lot 1). Every Add wait, it may add another lot only if Add cushion % (default 75%, never below Cushion %) and the lean are still with you and the ask is the last fill or up to Add band richer (0–10¢). If the ask has already jumped past that band, Cloud waits for it to come back — it does not chase. Stop adding with 30s left. Max lots is the cap. Size is Lot contracts × ask — not Auto $5.\n\n' +
            'From the first fill, a 1s watcher checks live bid/ask (websocket when the book is up). After Max lots it only watches for exits. A lot sells when ask ≤ that lot’s fill − Stop ¢ (bid IOC). If lot 1 stops, every remaining Step buy lot on that ticker sells. Sell if thesis dies is On by default: if the gap falls under Cushion % or the lean flips, Cloud dumps the stack at the live bid. 5s grace after each fill. Protect skips these rows.\n\n' +
            'Window cap 1 blocks lot 1 if Auto / Home / Cash out already filled this coin. Later Step buy lots are extra. Open Step buy sits Auto / Home / Cash out / Last-minute out of that ticker. TWAP still owns BTC/ETH if that path is On. Last-minute owns new buys if it is in its buy window and Step buy has no lots yet.',
        },
        {
          id: 'step-buy-risk-hidden',
          q: 'Why don’t I see Step buy on Risk?',
          a:
            'The Admin portal Feature configs switch “Step buy” is Off (default). When an admin turns it On, the block appears on Auto-trade. Your Step buy switch stays Off until you turn it on.',
        },
      ],
    },
    {
      id: 'spike-fade',
      title: 'Spike fade',
      items: [
        {
          id: 'what-is-spike-fade',
          q: 'What is Spike fade?',
          a:
            'A separate Auto path (Admin must turn it On first). Settings → Risk → Auto-trade → Spike fade. Default Off. Pick assets on that block; they must also be On in Cushions. Empty means no Spike fade buys. This is not Gold fade. Gold fade stays Gold-only on a small $ gap and take/stop vs fill.\n\n' +
            'After Start after and before Until minute (default minutes 2–6), if the expensive-side ask is in Expensive min…max (default 75–80¢) and the cheap-side ask is in Cheap min…max (default 20–25¢), Cloud buys the cheap side. Size is Lot contracts × live ask — not Auto $5. Example: YES $0.78 and NO $0.22 → buy NO. YES $0.82 or NO $0.18 → sit out.\n\n' +
            'From the fill, a 1s watcher sells IOC at the bid: take when the cheap bid ≥ Take ask (default 42¢), stop when the cheap ask ≤ Stop ask (default 10¢), flatten when minutes left ≤ Flatten left (default 3) or the window ends. Always dumps — no hold to $1. 5s grace after fill. One lot per ticker per window. Protect skips these rows.\n\n' +
            'While On for that chip and inside the enter window, Auto / Cash out / Gold fade sit that ticker out. After Until minute with no lot, those paths may use the coin again. Open Spike fade sits Home / Auto / Cash out / Gold fade / Last-minute / Step buy / Pair lock out. TWAP still owns BTC/ETH if that path is On. Last-minute owns new buys if it is in its buy window and Spike fade has no lot yet.',
        },
        {
          id: 'spike-fade-risk-hidden',
          q: 'Why don’t I see Spike fade on Risk?',
          a:
            'The Admin portal Feature configs switch “Spike fade” is Off (default). When an admin turns it On, the block appears on Auto-trade. Your Spike fade switch stays Off until you turn it on.',
        },
      ],
    },
    {
      id: 'pair-lock',
      title: 'Pair lock',
      items: [
        {
          id: 'what-is-pair-lock',
          q: 'What is Pair lock?',
          a:
            'A separate Auto path (Admin must turn it On first). Settings → Risk → Auto-trade → Pair lock. Default Off. Pick assets on that block; they must also be On in Cushions. Empty means no Pair lock buys.\n\n' +
            'After Start after and before Until minute (default minutes 2–10), Cloud buys the Auto lean side if that ask is at or under Runner max ask (default 60¢). Lock first (default On) also requires the opposite ask already locks at least Min lock (default 5¢). Size is Lot contracts × live ask — not Auto $5. If both sides already lock Min lock, Cloud fires YES and NO IOC on the same tick. One fill and one miss waits Recover wait. Lock first Off still does that when the book already locks; otherwise it buys the runner alone so you get more first legs. Example with Lock first On: YES 52¢ and NO 18¢ → both IOC. YES 52¢ and NO 48¢ sits out.\n\n' +
            'From a sequential runner fill, a 1s watcher buys the opposite side when runner fill + opposite ask ≤ $1 − Min lock. After Recover wait (default 20s, 10–60 on the tile), if that 5¢ hedge is gone: buy the dog only if fill + ask ≤ 99¢, else sell the runner if its bid is fill + 2¢, else compare finish vs dump and take the strictly smaller hole. 52¢ + 18¢ = 70¢ locks +30¢ at settlement. Hedge count matches the runner. Hedge does not wait the 5s grace. Window cap 1 blocks the runner only.\n\n' +
            'Add new pair (default 0, max 3) is extra pairs after that first lock. 0 = first pair only. 3 = 3 more (4 pairs total). Only after both first-pair legs fill. If live YES+NO asks still lock Min lock, Cloud fires YES and NO together on that hedge-fill pulse, then every 1s while the pair stays locked and Add new pair still has room. If one fills and one misses, it compares finish vs dump and takes the strictly smaller hole.\n\n' +
            'A completed pair holds both sides to $1. No take, stop, Protect, or Home Sell. If the second leg is still missing, Cloud sells the runner IOC at the bid when minutes left ≤ Flatten unmatched (default 3), the window ends, or live runner ask ≤ fill − Runner stop (default 10¢; $0 = off) and the hedge is still too rich to lock. 5s grace after the runner fill for flatten / runner stop only. The sell does not cap the loss at exactly the stop if the bid gaps. After that sell we do not buy the other leg on this ticket.\n\n' +
            'While On for that chip and inside the enter window, Auto / Cash out / Gold fade sit that ticker out. After Until minute with no runner, those paths may use the coin again. Open runner or open pair sits Home / Auto / Cash out / Gold fade / Last-minute / Step buy / Spike fade out. TWAP still owns BTC/ETH if that path is On. Last-minute owns new buys if it is in its buy window and Pair lock has no runner and no pair. Spike fade and Step buy take first pick for new buys when they want the ticker. Protect skips these rows.',
        },
        {
          id: 'pair-lock-risk-hidden',
          q: 'Why don’t I see Pair lock on Risk?',
          a:
            'The Admin portal Feature configs switch “Pair lock” is Off (default). When an admin turns it On, the block appears on Auto-trade. Your Pair lock switch stays Off until you turn it on.',
        },
      ],
    },
    {
      id: 'cap-lock',
      title: 'Cap lock',
      items: [
        {
          id: 'what-is-cap-lock',
          q: 'What is Cap lock?',
          a:
            'A separate Auto path (Admin must turn it On first). Settings → Paths → Cap lock. Default Off. Every 15m catalog chip is listed, including HYPE. Empty chips mean no Cap lock buys. The asset must also be On in Cushions.\n\n' +
            'No lean and no cushion. Cloud buys YES and NO on the same ticker when the two live asks plus Kalshi fees still fit $1 + Max lock loss (default 5¢). Richer ask first. Second size matches the first fill. A 0-fill first leg does not send the second. One pair per ticker per window. Sitting out because the book is rich does not burn the window when Allow later is On.\n\n' +
            'Example: 50¢ + 50¢ + about 4¢ fees → about −4¢ → buy both if Max lock loss is 5¢. 52¢ + 52¢ sits. Window cap 1 does not block this path. A matched pair holds both sides to $1. Unmatched leftover gets one retry if it still fits the cap, else it flattens. History Sell stays hidden on a matched pair. Protect / Cash out / Gold fade skip these rows. When Cap lock is On for a chip, Cushion Auto lean sits that coin.',
        },
        {
          id: 'cap-lock-risk-hidden',
          q: 'Why don’t I see Cap lock on Risk?',
          a:
            'The Admin portal Feature configs switch “Cap lock” is Off (default). When an admin turns it On, the tile appears on Paths. Your Cap lock switch stays Off until you turn it on.',
        },
      ],
    },
    {
      id: 'buffer-run',
      title: 'Buffer run',
      items: [
        {
          id: 'what-is-buffer-run',
          q: 'What is Buffer run?',
          a:
            'A separate Auto path (Admin must turn it On first). Settings → Paths → Buffer run. Default Off. BTC and ETH chips only. Empty chips mean no Buffer run buys. The asset must also be On in Cushions.\n\n' +
            'Mid-window lean scalp: after Enter after (default 3 minutes) and while Enter left (default 5) remain, Cloud buys the lead side when spot lead clears max(BTC $40 / ETH $2.50 floor, ATR×1.25) and that ask sits in Ask min…Ask max (default 42–62¢). Skip when YES+NO ≤ Pair-sum skip (default 0.98). Size is path $ per trade (default $2.50) — not Auto $.\n\n' +
            'One trade per ticker per window. Exits: Take (+12¢), Stop (−7¢), lean flip, or Flatten (≤ 3 minutes left). Never hold to $1. TWAP / Last-minute / Spike / Step / Pair / Cap / Cheap sit it out when they own the coin. Protect skips these rows.',
        },
        {
          id: 'buffer-run-risk-hidden',
          q: 'Why don’t I see Buffer run on Risk?',
          a:
            'The Admin portal Feature configs switch “Buffer run” is Off (default). When an admin turns it On, the tile appears on Paths. Your Buffer run switch stays Off until you turn it on.',
        },
      ],
    },
    {
      id: 'cheap-loop',
      title: 'Cheap loop',
      items: [
        {
          id: 'what-is-cheap-loop',
          q: 'What is Cheap loop?',
          a:
            'A separate Auto path (Admin must turn it On first). Settings → Paths → Cheap loop. Default Off. Empty chips mean no buys. The asset must also be On in Cushions.\n\n' +
            'After Start after and before Flatten left, Cloud buys the cheaper YES or NO if that ask is at or under Cheap max, at least 20¢, the other ask is at most 80¢, the YES/NO gap is at least Min gap, and |live − strike| is at least Min live % of that coin’s Cushions $ (default 15%; 0 = off). BTC, SOL, and DOGE each use their own cushion — you do not pick a dollar per coin. Size is Lot contracts × live ask — not Auto $5. Example: YES 30¢ and NO 70¢ → buy YES. 22¢ / 76¢ buys. 11¢ / 90¢ sits. 49¢ / 51¢ sits out. A tiny BTC drift that is still well under 15% of your BTC cushion also sits.\n\n' +
            'After Min hold, it sells IOC at the bid when that bid is fill + Take. Stop is Off unless you turn it On — then after Min hold it dumps bid IOC when that bid is fill − Stop (default 6¢, 5–12¢). Flatten dumps in the last Flatten left minutes or at window end. Then Cooldown, then it looks again until Cycles exits are done. Always dumps. Never both sides. Never hold to $1.\n\n' +
            'Window cap 1 does not block this path — Cycles is the cap. Spike fade, Step buy, and Pair lock still take first pick. TWAP still owns BTC/ETH. Last-minute owns new buys if Cheap loop has no lot. Protect skips these rows. Home tap or any other open fill blocks a new Cheap loop buy.',
        },
        {
          id: 'what-is-cheap-loop-hourly',
          q: 'What is Cheap loop Hourly?',
          a:
            'A second switch on the Cheap loop tile (same Admin flag). Default Off. Empty hourly chips mean no hourly buys.\n\n' +
            'Kalshi hourly is above/below strike ladders (KXBTCD, KXETHD, …), not the 15m up/down book. Cloud picks the unique ATM strike closest to live. A tie sits out. After a fill it holds that ticker until Take, Stop (if On), or Flatten — it does not hop strikes. Cycles count per hour event (default 2, max 10). One open hourly lot per coin.\n\n' +
            'Start after default 10 minutes, Flatten left 5, Cheap max $0.40, Min gap 10¢, Take 5¢, Stop Off (On = 6¢, 5–12¢), Min hold 2, Cooldown 3, Cycles 2 (max 10). Window cap 1 does not block. TWAP / Last-minute / Spike / Step / Pair stay on 15m. 15m Cheap loop and Hourly may both hold. Protect skips these rows.',
        },
        {
          id: 'what-is-cheap-loop-weekly',
          q: 'What is Cheap loop Weekly?',
          a:
            'A third switch on the Cheap loop tile (same Admin flag). Default Off. Empty weekly chips mean no weekly buys.\n\n' +
            'Same Kalshi above/below series as Hourly (KXBTCD, …). Cloud picks the live event that lasts about a week (3–14 days), not the hour or the day. Nearest ATM strike (picks one on a tie). After a fill it holds that ticker until Take, Stop, Flatten, or you tap History Sell. Then Cooldown (minutes), then it looks for the cheaper ATM side again. Cycles count exits this weekly event (default 10, max 50). One open weekly lot per coin.\n\n' +
            'Start after 10 minutes, Flatten left 2 hours (30 min–12 hr), Cheap max $0.45, Min gap 8¢, Take 8¢, Stop On at 12¢, Min hold 2, Cooldown 3. Weekly chips default BTC and ETH. 15m, Hourly, and Weekly may all hold. Protect skips these rows.',
        },
        {
          id: 'cheap-loop-history-sell',
          q: 'What does History Sell do?',
          a:
            'On any pending open fill (Home, Auto, Cash out, Gold fade, TWAP, Last-minute, Step buy, Spike fade, Pair lock, Cheap loop 15m/hourly/weekly), History shows Sell and live profit (cost vs current ask) when that ticker’s ask is on the phone.\n\n' +
            'Tap sells that contract now on Kalshi’s book (bid IOC). A confirm dialog, then Placing… so a double tap cannot fire twice. If IOC misses, the fill stays pending. If Cloud already sold it, you get “already sold.”\n\n' +
            'Works with Auto Off and with Kill switch (emergency dump). It does not use Home Buy/Sell. Cheap loop still counts a successful History Sell as an exit (cycle + cooldown).',
        },
        {
          id: 'cheap-loop-risk-hidden',
          q: 'Why don’t I see Cheap loop on Paths?',
          a:
            'The Admin portal Feature configs switch “Cheap loop” is Off (default). When an admin turns it On, the tile appears on Settings → Paths. Your Cheap loop switch stays Off until you turn it on.',
        },
      ],
    },
    {
      id: 'skipthin',
      title: 'Skip thin bid',
      items: [
        {
          id: 'skip-thin-bid-paths',
          q: 'What does Skip thin bid do on each path?',
          a:
            'Each Cloud path has its own Skip thin bid checkbox (default Off), shown only when that path is On. Home Buy does not use it.\n\n' +
            'Cloud looks at how many contracts sit on the best bid versus the contracts you are about to buy, or already hold. The paths do not share one switch — Cash out, Gold fade, Spike fade, and Pair lock can sell when the book thins (Pair lock only dumps an unmatched runner); TWAP lock, Last-minute, Step buy, and Cheap loop only skip the buy (Step buy still runs its ask stop; Cheap loop still take / flatten).',
          table: {
            headers: ['Path', 'If thin', 'If book size unknown'],
            rows: [
              [
                'Cash out',
                'Skip the buy. If you already hold, sell.',
                'Does not skip or dump',
              ],
              [
                'Gold fade',
                'Skip the buy. If you hold, sell / dump.',
                'Same as Cash out',
              ],
              [
                'TWAP lock',
                'Skip the buy only. Still hold to $1.',
                'Fail closed — no buy',
              ],
              [
                'Last-minute',
                'Skip the buy only. Still hold to settlement.',
                'Fail closed — no buy',
              ],
              [
                'Step buy',
                'Skip the buy only. Stops still run.',
                'Fail closed — no buy',
              ],
              [
                'Spike fade',
                'Skip the buy. If you hold, sell / dump.',
                'Fail closed — no buy',
              ],
              [
                'Pair lock',
                'Skip the buy. Unmatched runner can dump. Locked pair holds.',
                'Fail closed — no buy',
              ],
              [
                'Cheap loop',
                'Skip the buy only. Open lots still take / flatten.',
                'Fail closed — no buy',
              ],
            ],
          },
        },
      ],
    },
    {
      id: 'kalshi',
      title: 'Kalshi API keys',
      items: [
        {
          id: 'how-to-get-key',
          q: 'How do I get a Kalshi API key?',
          a:
            'You need a Kalshi account first. In Predict, tap the i next to Kalshi credentials for the step-by-step (website profile → API Keys → copy Key ID → save the PEM immediately — Kalshi often shows the private key only once).\n\n' +
            'In Settings: paste Key ID, paste or Import the PEM, Save to Secure Store, then Test connection. Never email or post the PEM.',
        },
        {
          id: 'wipe-keys',
          q: 'What does Wipe credentials do?',
          a:
            'It removes the Key ID and private key from this phone’s Secure Store after you confirm. Cloud auto-trading cannot sign Kalshi orders without keys.\n\n' +
            'It does not cancel your Predict Pro subscription and does not close Kalshi positions already open.',
        },
      ],
    },
    {
      id: 'screens',
      title: 'Home, History, Dashboard & Alerts',
      items: [
        {
          id: 'home-numbers',
          q: 'What do the Home money numbers mean?',
          a:
            'Cash and Predictions totals come from your Kalshi account (when keys work). Change (24h) is that Predictions total vs yesterday’s saved value — Kalshi-style, not only today’s Predict fills.\n\n' +
            'Each asset row is the current lean, gap, and last action. Gap is the dollar distance between live price and strike. ▲ live over strike. ▼ live under strike (gray). If you already hold that window, it says “with you” (green) or “against you” (red) so you know whether to sell. Pull down to refresh.',
        },
        {
          id: 'history',
          q: 'What is History vs Dashboard vs the bell?',
          a:
            'History = every Predict fill and alert on this phone, with filters (pending, win, loss, miss). Status dots: green settled win / still favorable, yellow checking, red unfavorable or settled loss, gray IOC miss.\n\n' +
            'Home pulls Cloud alerts after each poll so a lean can show in History without opening this tab.\n\n' +
            'Dashboard = today’s Predict stats (ET): win rate, closed P&L from Predict fills today, W/L, pending, IOC misses, alerts logged, unread. The Trades card shows fill totals by path (Home / Auto / …). A “Fills today by path” card above Closed P&L by asset splits those fills by coin. The by-asset card lists W/L, P&L, and won-at / lost-at contract prices (what you bought the ticket for). Closed P&L is not the same as Change (24h).\n\n' +
            'Bell (top right) = new alerts since you last opened Alerts (bell page or History → Alerts). Leaving that list clears the badge. Bell mute is only the lock-screen ping (see “Mute vs Notify on lean signals”). Delete still removes rows.',
        },
        {
          id: 'export',
          q: 'How do I export my history?',
          a:
            'Tap the share/export icon in the top-right (next to the bell; panic Kill Switch is left of Export). You get a spreadsheet of trades, alerts, and risk-acceptance notes to save or send.\n\n' +
            'Still never put your PEM in that file or in email.',
        },
        {
          id: 'alert-retention',
          q: 'How long are alerts kept? Why is there no “stored alerts” number in Settings?',
          a:
            'Settings → Alerts → Keep alert history (default 30 days, 1–365). Older rows auto-delete on this phone. “Prune older alerts now” deletes anything past that window on this phone and in Cloud; today’s stay.\n\n' +
            'The count lives on Dashboard as Alerts logged (and in the Alerts hub). Settings does not repeat that number.\n\n' +
            'A new install receives up to the 400 most recent Cloud alerts.',
        },
        {
          id: 'mute-vs-lean-toggle',
          q: 'Mute vs Notify on lean signals — what is the difference?',
          a:
            'Two different controls. Easy to mix up.\n\n' +
            'Bell mute matrix (bell page → Mute matrix):\n' +
            '• Per type: leans, fills, misses, wins/losses, and so on.\n' +
            '• Mute = no lock-screen ping for that type.\n' +
            '• The row still appears on the bell page and in History → Alerts (“silent log”).\n' +
            '• Auto-trade is unchanged.\n\n' +
            'Settings → Notify on lean signals (off):\n' +
            '• New lean signals stop completely — no ping and no new lean row on the bell page or History.\n' +
            '• Fills, misses, Trade won/lost, Protect sells, and daily loss stop still show on the bell page.\n' +
            '• Side effect: all lock-screen pings stop, including fills and wins. Bell mute “push on” cannot override this.\n\n' +
            'Want no leans anywhere, but still hear fills? Leave Notify on lean signals ON. On the bell page, mute only Lean signals.\n\n' +
            'Want a quiet lock screen but keep the list? Leave Notify on lean signals ON. Mute the types you do not want to hear.',
        },
        {
          id: 'mute-sounds',
          q: 'How do sounds and mutes work?',
          a:
            'Pings (leans, fills, protect, trade results, IOC misses, daily loss stop) come from Cloud Run so the phone does not play the same event twice.\n\n' +
            'To quiet one type but keep the list: bell page → Mute matrix.\n\n' +
            'To stop new lean rows (and all lock-screen pings): Settings → Notify on lean signals off.\n\n' +
            'A lean below your cushion is not stored and has no sound.\n\n' +
            'See “Mute vs Notify on lean signals — what is the difference?” for the full split.',
        },
      ],
    },
    {
      id: 'support',
      title: 'Help & troubleshooting',
      items: [
        {
          id: 'no-order',
          q: 'Home says “no order” — is that a bug?',
          a:
            'Last signals shows at most one extra line so Auto-trade and Home Buy do not fight on the same card. If two paths share a ticker, the line says who owns that window and who sits out.\n\n' +
            '• SKIP (amber) — not a buy. The line under it is the reason: “below cushion” only when this 15-minute market is live and the gap is still inside your cushion. “next window” = the next 15-minute market is not open yet. “window ended” = this 15-minute market already closed. A large gap can still show on those last two; that is not a cushion miss.\n\n' +
            '• YES/NO with a Home skip under it (Buy hidden) — Cloud would reject the same Home Buy gate (ask too rich, too early, too little time, size too small, shared cap). Auto-trade’s skip is not shown on that row.\n\n' +
            '• YES/NO with Buy showing and no skip — a tap would place under Home Buy rules. Auto-trade may have skipped; that is not shown next to Buy.\n\n' +
            '• No Buy/Sell button and no Home skip — Auto-trade’s last skip or fill can show.\n\n' +
            'Open Settings → Risk → i for what each limit means.',
        },
        {
          id: 'connection-fail',
          q: 'Test connection failed. What should I try?',
          a:
            'Confirm Key ID and the full PEM (including BEGIN/END lines). Save again, then Test connection.\n\n' +
            'If Kalshi is down or the key was revoked, create a new API key in Kalshi and update Predict. Face ID is used to unlock/edit secrets.\n\n' +
            `If it still fails, email ${email}. Do not attach the private key. Say whether Test connection showed an HTTP error.`,
        },
        {
          id: 'contact-support',
          q: 'How do I contact support?',
          a:
            `Email ${email} (also at the bottom of Settings). Typical topics: restore purchases, trial, Face ID, connection test, missing trades on History.\n\n` +
            'Include your Apple ID email if it is about billing. Never send Kalshi private keys.\n\n' +
            'Support can help with the app. Support cannot reverse a settled Kalshi market or guarantee a fill.',
        },
      ],
    },
  ];
}

export function flattenFaqItems(categories = getFaqCategories()): FaqItem[] {
  return categories.flatMap((c) => c.items);
}

export function faqItemSearchText(item: FaqItem): string {
  const table = item.table
    ? `\n${item.table.headers.join(' ')}\n${item.table.rows.map((row) => row.join(' ')).join('\n')}`
    : '';
  return `${item.q}\n${item.a}${table}`;
}
