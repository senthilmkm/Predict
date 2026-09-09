/**
 * In-app FAQ — plain English Q&A for Settings.
 * Native UI only (not HTML). Keep answers aligned with live product behavior.
 */
import { supportContactEmail } from '../config/appMeta';

export type FaqItem = {
  id: string;
  q: string;
  a: string;
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
            'You can get alerts only, or turn on Auto-trade so Cloud Run may place real Kalshi orders using your own API key.\n\n' +
            'Example: Gold strike $2,650, your cushion is $7, live gold is $2,660. Gap is $10, which is more than $7, so the lean can be YES.',
        },
        {
          id: 'who-owns-account',
          q: 'Does Predict hold my Kalshi money?',
          a:
            'No. Predict never holds your cash. Trades go to your own Kalshi account with your API key.\n\n' +
            'Your Kalshi cash and open contracts stay at Kalshi. Predict only sends orders when you turn Auto-trade (or Protect money) on and the rules pass.',
        },
        {
          id: 'what-markets',
          q: 'What markets does Predict trade?',
          a:
            'Only Kalshi 15-minute contracts for the assets in the Cushions tab.\n\n' +
            'Crypto (24/7): BTC, ETH, SOL, DOGE, XRP, BNB, AVAX, SUI, LINK.\n' +
            'Commodities (CME hours): Gold, Silver, WTI, Natural Gas, Copper.\n' +
            'US stock hours: S&P 500, Nasdaq 100.\n' +
            'Forex hours: EUR/USD, GBP/USD, USD/JPY.\n\n' +
            'A new 15-minute contract starts every quarter hour (for example 10:00, 10:15, 10:30). Predict does not trade longer Kalshi events.',
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
            'No. Trading involves risk of loss. Predict does not guarantee profits or successful trades — whether you use alerts only, Auto-trade, or both.\n\n' +
            'Past results on Home, Dashboard, or History do not predict the next contract. You can lose some or all of the money you risk on Kalshi.',
        },
        {
          id: 'is-this-advice',
          q: 'Is this financial or trading advice?',
          a:
            'No. Nothing in Predict is financial, investment, legal, or trading advice.\n\n' +
            'Predict is not a broker, investment adviser, or money manager. It does not owe you a fiduciary duty. You decide whether to use alerts, Auto-trade, and Protect money.',
        },
        {
          id: 'who-is-liable',
          q: 'Who is responsible if I lose money?',
          a:
            'You are. That includes:\n' +
            '• trades you place yourself on Kalshi after seeing a Predict alert\n' +
            '• trades Cloud Run places when Auto-trade is On\n' +
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
            'Review every alert yourself before you place anything outside Predict.',
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
            'Auto-trade On = Cloud Run may place real Kalshi buy orders when cushions and Risk rules pass. Face ID is required to turn this On.\n\n' +
            'They are independent. Example: alerts On + Auto-trade Off = research pings only. Alerts Off + Auto-trade On = orders can still place; lean notification sounds stay quiet.',
        },
        {
          id: 'need-keys-for-alerts',
          q: 'Do I need a Kalshi API key for alerts only?',
          a:
            'No. Alerts can run without keys. Allow notifications during setup (or later in iOS Settings) if you want pings when Predict is closed.\n\n' +
            'You need a saved Key ID + private key PEM for Auto-trade, Protect money sells, settlement checks, and Kalshi balances on Home. Tap Test connection after you save keys.',
        },
        {
          id: 'kill-switch',
          q: 'What does the Home kill switch do?',
          a:
            'It turns Auto-trade Off right away on this phone and syncs that Off state to Cloud Run, so new automatic buys should stop.\n\n' +
            'It does not turn Protect money Off. If Protect money is still On, Cloud Run may still try to sell open trades.\n\n' +
            'Cloud Run still settles fills you already have and can still write Trade won / Trade lost.\n\n' +
            'To stop new buys and early sells: Auto-trade Off, and turn Protect money Off under Settings → Risk.',
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
            '• place Protect money sells when that switch is On\n' +
            '• record fills and settlements on your user in Firestore (settlements continue after Auto-trade Off if keys are saved)\n\n' +
            'Your Risk numbers and asset on/off flags are stored with your user so the server uses the same rules as Settings.',
        },
        {
          id: 'who-sells',
          q: 'Does the phone ever buy or sell?',
          a:
            'No. Auto-trade buys and Protect money sells are placed by Cloud Run only. The phone does not send buy or sell orders.\n\n' +
            'Protect money still runs 24/7 on Cloud Run even if Auto-trade (new buys) is Off — as long as the Protect money switch is On and keys are saved.',
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
            '• US indices: about 9:30 AM–4:00 PM ET, weekdays\n' +
            '• Forex: weekend pause from Friday evening to Sunday 5:00 PM ET\n' +
            '• Gold, oil, and other CME commodities: weekend pause and a daily ~5:00–6:00 PM ET halt, plus listed holidays\n\n' +
            'Home may show a weekend/holiday banner. Closed assets are skipped; crypto can still lean.',
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
            'Settings → Risk → Show. Tap the i next to Risk for a label-by-label guide.\n\n' +
            'Defaults: $5 per trade, max $5, min $1, max 5 open positions, 100 new buys per day, 1 buy per asset per 15-minute window, $50 daily loss stop, wait 2 minutes after the window opens, need 2 minutes left, max ask $0.90, IOC, chase $0.02, Protect money Off.',
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
            'Max trades / day = total new buys today across all assets.\n\n' +
            'Daily loss stop = if today’s locked-in losses reach this dollar amount (default $50), new buys stop for the day. It is a brake, not a reverse of past losses.',
        },
        {
          id: 'timing-and-ask',
          q: 'Why did it skip with “too early,” “too little time,” or “size too small”?',
          a:
            'Min minutes elapsed (default 2) = don’t buy in the noisy open. “Too early in window” means this clock has not been reached.\n\n' +
            'Min minutes left (default 2) = don’t buy in the last minutes. “Too little time left” means the window is too close to expiry. These two buy-timing rules do not block Protect money sells.\n\n' +
            'Max entry ask (default $0.90) = don’t buy a very expensive ticket.\n\n' +
            'Min $ / trade (default $1) = if the order would be smaller than this (often when the contract price is high), it skips “size too small.” Keep min below $ per trade.',
        },
        {
          id: 'tif-and-chase',
          q: 'What are IOC / FOK / GTC and chase above ask?',
          a:
            'Time in force is how long a buy stays on Kalshi (Auto-trade buys):\n' +
            '• IOC (default) = fill what you can now, cancel the rest\n' +
            '• FOK = fill all now or cancel all\n' +
            '• GTC = leave it working until filled or canceled\n\n' +
            'Most people keep IOC on these short windows. Protect money sells always use IOC.\n\n' +
            'Chase above ask (default $0.02) is a tiny extra you allow above the ask to help a buy fill, still capped by Max entry ask. The same idea is used as sell slippage on protect-sell.',
        },
        {
          id: 'restore-risk',
          q: 'What does Restore default values do?',
          a:
            'It puts all Risk numbers back to the app’s starting set stored on this phone, including Protect money Off.\n\n' +
            'It does not wipe Kalshi keys, subscription, or Cushions (cushions have their own restore on the Cushions tab).',
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
            'When On, if you already hold a fill and the live lean flips strongly against you, Cloud Run sends an IOC sell after the wait-after-fill.\n\n' +
            'Default wait is 45 seconds so the first noisy ticks after a buy don’t instantly sell. After that wait, a sell can fire at any remaining time in the window — not only in the last minutes.\n\n' +
            'When Off (default), open trades ride until the 15-minute contract settles win or loss.',
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
            'Each asset row is the current lean, gap, and last action. Pull down to refresh.',
        },
        {
          id: 'history',
          q: 'What is History vs Dashboard vs the bell?',
          a:
            'History = every Predict fill and alert on this phone, with filters (pending, win, loss, miss). Status dots: green settled win / still favorable, yellow checking, red unfavorable or settled loss, gray IOC miss.\n\n' +
            'Home pulls Cloud alerts after each poll so a lean can show in History without opening this tab.\n\n' +
            'Dashboard = today’s Predict stats (ET): win rate, closed P&L from Predict fills today, W/L, pending, IOC misses, alerts logged, unread. Closed P&L is not the same as Change (24h).\n\n' +
            'Bell (top right) = Alerts hub: recent alerts, mute by type, delete. That count is the same family as Dashboard “Alerts logged.”',
        },
        {
          id: 'export',
          q: 'How do I export my history?',
          a:
            'Tap the share/export icon in the top-right (next to the bell). You get a spreadsheet of trades, alerts, and risk-acceptance notes to save or send.\n\n' +
            'Still never put your PEM in that file or in email.',
        },
        {
          id: 'alert-retention',
          q: 'How long are alerts kept? Why is there no “stored alerts” number in Settings?',
          a:
            'Settings → Signal alerts → Keep alert history (default 30 days, 1–365). Older rows auto-delete on this phone. “Prune older alerts now” deletes anything past that window on this phone and in Cloud; today’s stay.\n\n' +
            'The count lives on Dashboard as Alerts logged (and in the Alerts hub). Settings does not repeat that number.\n\n' +
            'A new install receives up to the 400 most recent Cloud alerts.',
        },
        {
          id: 'mute-sounds',
          q: 'How do sounds and mutes work?',
          a:
            'Master switch: Settings → Notify on lean signals.\n\n' +
            'Per type: open the bell → expand mute options. You can mute lean signals, orders placed, fills, IOC misses, trade results, protect-sells, daily loss stop, and errors.\n\n' +
            'Lean, fill, protect-sell, trade result, IOC miss, and daily loss stop sounds are sent from Cloud Run so the phone does not play the same event twice.\n\n' +
            'A lean below your cushion is stored in History without a sound.',
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
            'Usually not. It means a risk gate skipped the buy (too early, too little time, max open, window cap, daily cap, loss stop, ask too high, size too small, asset off, or market closed).\n\n' +
            'Read the short reason on Home. Open Settings → Risk → i for what each limit means.',
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
