/** Risk i-icon copy: uses / does not use / isolation. Shown in Alert.alert. */

export const PATH_INFO = {
  shared: {
    title: 'Shared limits',
    body:
      'Uses\n' +
      '• Max open positions\n' +
      '• Max trades / day\n' +
      '• Max trades / asset / 15m window (window cap 1)\n' +
      '• Daily loss stop\n\n' +
      'Applies to Home Buy and every Auto path (Auto-trade, Cash out, Gold fade, TWAP lock, Last-minute first clip, Step buy lot 1, Spike fade, Pair lock runner).\n\n' +
      'Does not use\n' +
      '• Cushions $ gap (Cushions tab)\n' +
      '• Asset on/off (Cushions tab)\n' +
      '• Path-only fields (ask, minutes, Protect, Smart buy, Last-minute clips)\n\n' +
      'Isolation\n' +
      '• Window cap 1 is one fill per coin per 15m window for Home / Auto / Cash out / fade / TWAP / Last-minute first clip / Step buy lot 1 / Spike fade / Pair lock runner\n' +
      '• Last-minute ladder clips after that first Last-minute fill are extra (up to Max clips)\n' +
      '• Step buy lots after lot 1 are extra (up to Max lots)\n' +
      '• Pair lock hedge is extra (same count as the runner)',
  },
  home: {
    title: 'Home Buy',
    body:
      'Uses\n' +
      '• This tab’s $ per trade / min / max\n' +
      '• Minutes left and elapsed\n' +
      '• Home max entry ask, TIF, chase\n' +
      '• Shared limits\n' +
      '• Cushions $ gap and asset on/off (Cushions tab)\n\n' +
      'Does not use\n' +
      '• Auto max ask, Auto TIF, Auto chase\n' +
      '• Smart buy\n' +
      '• Cash out / Gold fade / TWAP lock / Last-minute fields\n\n' +
      'Isolation\n' +
      '• A tap still spends real money even if Auto-trade is Off\n' +
      '• Will not buy a ticker Cash out, Gold fade, TWAP lock, Last-minute, Step buy, Spike fade, or Pair lock already holds\n' +
      '• A Home fill counts toward window cap 1 (Last-minute first clip then sits out)\n' +
      '• Protect money can later sell a Home fill (if Protect is On)\n' +
      '• Home Sell is IOC; slippage is Home Buy chase',
  },
  auto: {
    title: 'Auto-trade',
    body:
      'Uses\n' +
      '• This tab’s $ per trade / min / max\n' +
      '• Minutes left and elapsed (default 2 / 2 — no last-minute chase)\n' +
      '• Auto max entry ask, TIF, chase\n' +
      '• Cushions $ gap, Smart buy (if On), shared limits, asset on/off\n\n' +
      'Does not use\n' +
      '• Home Buy size/timing\n' +
      '• Cash out / Gold fade / TWAP / Last-minute / Step buy / Spike fade / Pair lock ask, side, or lots\n\n' +
      'Isolation\n' +
      '• Default minutes left = 2, so Auto sits out the last minute\n' +
      '• If cushion already hit, this is the path — you do not need Last-minute on that coin\n' +
      '• If you set minutes left to 0, Auto can collide with Last-minute (window cap 1 wins)\n' +
      '• Will not enter a ticker another path already holds\n' +
      '• BTC/ETH leave Auto while TWAP lock is On for those chips',
  },
  smartBuy: {
    title: 'Smart buy',
    body:
      'Uses\n' +
      '• Auto-trade only (Home Buy ignores it)\n' +
      '• After cushion, minutes, and Auto max ask already pass — then also Min extra chance\n' +
      '• Shared caps\n\n' +
      'Does not use\n' +
      '• Cash out, Gold fade, TWAP lock, Last-minute\n' +
      '• Home Buy taps\n\n' +
      'Isolation\n' +
      '• Off = cushion + Auto risk only\n' +
      '• Does not guarantee more wins',
  },
  protect: {
    title: 'Protect money',
    body:
      'Uses\n' +
      '• Gap ≥ cushion × ratio, after the wait\n' +
      '• Can exit Auto and Home fills only\n' +
      '• Skips Step buy, Spike fade, and Pair lock rows — those paths stop themselves\n' +
      '• IOC sell; slippage from Auto chase\n\n' +
      'Does not use\n' +
      '• Minutes left / elapsed (after the wait, any time left)\n' +
      '• Cash out / Gold fade / TWAP lock / Last-minute lots — those paths hold or exit themselves\n\n' +
      'Isolation\n' +
      '• Does not place new buys\n' +
      '• Auto-trade Off does not turn Protect Off',
  },
  cashOut: {
    title: 'Cash out',
    body:
      'Uses\n' +
      '• Checked Cash out assets that are also On (Cushions tab on/off)\n' +
      '• Cushions $ × Enter cushion % (default 60% of the dollar gap — not the full cushion)\n' +
      '• Cash out max ask / bid / stop\n' +
      '• This path’s Skip thin bid (sells into the bid — thin book matters here)\n' +
      '• Auto $ per trade and shared caps\n' +
      '• Minutes left floor of 3 (never last-minute)\n\n' +
      'Does not use\n' +
      '• Auto max ask, Smart buy, chase, Protect\n' +
      '• Gold fade / TWAP / Last-minute fields\n' +
      '• Last-minute watch / clips / Both gate\n\n' +
      'Isolation\n' +
      '• Checked coins use Cash out instead of normal Auto\n' +
      '• Never shares an open ticker with Home, fade, TWAP, Last-minute, or Step buy\n' +
      '• BTC/ETH leave Cash out while TWAP lock is On for those chips\n' +
      '• Does not last-minute chase — Last-minute can still use the same coin if this window is empty',
  },
  goldFade: {
    title: 'Gold fade',
    body:
      'Uses\n' +
      '• Gold only (asset must be On)\n' +
      '• Max gap, max cheap ask, take, stop, flatten minutes\n' +
      '• Auto $ per trade, shared caps\n' +
      '• This path’s Skip thin bid (sells the lot — thin book matters here)\n\n' +
      'Does not use\n' +
      '• Cushions $ to enter (gap must be small)\n' +
      '• Auto max ask, Smart buy, Protect, Cash out bid/stop\n' +
      '• TWAP lock / Last-minute fields\n\n' +
      'Isolation\n' +
      '• Never shares an open ticker with Home, Auto, Cash out, TWAP, Last-minute, or Step buy\n' +
      '• Flatten default 3 minutes left — not a last-minute chase\n' +
      '• Full cushion flip dumps the lot on the way out\n' +
      '• Always dumps (take / stop / flatten / window end)',
  },
  twapLock: {
    title: 'TWAP lock',
    body:
      'Uses\n' +
      '• BTC / ETH chips (those assets must be On)\n' +
      '• This path’s max ask\n' +
      '• Auto $ per trade, window cap 1, shared caps\n' +
      '• This path’s Skip thin bid checkbox (default Off)\n' +
      '• IOC, 1-second CF Benchmarks watch in the last 60s\n' +
      '• $0 leftover lock only (banked ≥ strike × 60), Yes only\n\n' +
      'Does not use\n' +
      '• Cushions $ gap\n' +
      '• Auto max ask, Smart buy, chase, minutes left/elapsed\n' +
      '• Protect, Cash out, Gold fade, Last-minute, Home Sell\n\n' +
      'Isolation\n' +
      '• Checked coins leave Cash out and Auto for the whole 15m window\n' +
      '• Last-minute does not fight TWAP on those coins\n' +
      '• Hold to $1 — no stop, fade, or dump',
  },
  lastMinute: {
    title: 'Last-minute',
    body:
      'Uses\n' +
      '• Last-minute asset chips, and that asset On (Cushions tab on/off only — not the $ gap)\n' +
      '• Entry ask, Side (Yes / No / Both), Both min favorite, Both min gap\n' +
      '• Watch start, First clip by, Stop with, Ladder wait, Clip contracts, Max clips\n' +
      '• Sell if flip ≥ (0 = Off). Sells a lot only when the other side is that much richer\n' +
      '• Shared: max open, trades/day, daily loss stop\n' +
      '• Window cap 1 for the first clip only\n' +
      '• IOC, 1-second quotes from Watch start\n\n' +
      'Does not use\n' +
      '• Cushions $ gap. If the gap already reached cushion, play Auto / Home / Cash out — not this path\n' +
      '• Auto $ per trade (size is Clip contracts × live ask)\n' +
      '• Auto max ask, Smart buy, chase, minutes left/elapsed, Auto TIF\n' +
      '• Protect, Cash out, Gold fade, TWAP $0 lock, Home Sell\n' +
      '• Skip thin bid unless you turn that checkbox On (default Off — 1-contract IOC just misses if the book is thin)\n\n' +
      'Isolation\n' +
      '• Leftover path when the cushion thesis never showed\n' +
      '• Does not pull coins off Cash out or Auto — those paths already sit out the last minute\n' +
      '• Window cap 1: if Auto, Home, or Cash out already filled this coin this window, the first clip sits out\n' +
      '• After that first Last-minute fill, ladder adds are extra (up to Max clips of open lots)\n' +
      '• A flip sell frees that clip slot so the path can buy the new favorite\n' +
      '• If TWAP lock is On for BTC/ETH, those two stay with TWAP\n' +
      '• Open Step buy lots sit this ticker out\n' +
      '• Both = expensive side only (not a 50/50). Never Yes and No in the same window\n' +
      '• Hold to settlement unless Sell if flip is On — not Protect / Cash out / fade / Home Sell\n' +
      '• Not a lock. Last seconds can flip. You can lose the full entry ask',
  },
  stepBuy: {
    title: 'Step buy',
    body:
      'Uses\n' +
      '• Step buy asset chips, and that asset On (Cushions tab on/off). Empty chips = no Step buy buys\n' +
      '• Start after (minutes into the 15m window before lot 1)\n' +
      '• Cushion % of that coin’s Cushions $ — lot 1 and every add. Lean must stay on the same side\n' +
      '• Lot contracts (size of each lot), Add wait, Add band (lots 2+ only), Max lots, Stop, Entry ask\n' +
      '• Shared: max open, trades/day, daily loss stop\n' +
      '• Window cap 1 for lot 1 only\n' +
      '• IOC. 1-second ask watch from the first fill (stops). After Max lots the watcher is stop-only\n\n' +
      'Does not use\n' +
      '• Auto $ per trade (size is Lot contracts × live ask)\n' +
      '• Auto max ask, Smart buy, chase, minutes left, Auto TIF\n' +
      '• Full cushion — only Cushion % of the $ gap\n' +
      '• Protect, Cash out, Gold fade, TWAP $0 lock, Last-minute clips, Home Sell\n' +
      '• Skip thin bid unless you turn that checkbox On (default Off)\n\n' +
      'Isolation\n' +
      '• Own path. Default Off. Admin must enable the block first\n' +
      '• Follows the Auto lean (YES or NO). Never both sides on one ticker\n' +
      '• Lot 1 only after Start after + Cushion % + lean + Entry ask\n' +
      '• Later lots need Add wait, Cushion % + lean still with you, and ask between last fill and last fill + Add band\n' +
      '• Add band 0 = next ask must match the last fill. Band does not apply to lot 1\n' +
      '• If the ask has already run past last fill + Add band, Cloud waits for it to come back — it does not chase. Widen the band (up to 10¢) if you still want that add after a jump\n' +
      '• Stop adding with 30s left (code, not a knob). Stops still run in those last 30s\n' +
      '• 5s grace after each fill so your own print does not stop you out\n' +
      '• Sell a lot when live ask ≤ that lot’s fill − Stop ¢. Sell is bid IOC\n' +
      '• Lot 1 stop sells every remaining Step buy lot on that ticker\n' +
      '• Sold lots free Max lots slots (open lots only)\n' +
      '• Window cap 1: Auto / Home / Cash out fill this window blocks lot 1. Later Step buy lots are extra\n' +
      '• Open Step buy: Auto / Home / Cash out / Last-minute / Pair lock sit out that ticker\n' +
      '• If Last-minute is in its buy window and Step buy has no lots yet, Last-minute owns new buys\n' +
      '• If TWAP lock is On for BTC/ETH, those two stay with TWAP\n' +
      '• Protect skips Step buy rows\n' +
      '• Hold to settlement unless a stop already fired',
  },
  spikeFade: {
    title: 'Spike fade',
    body:
      'Uses\n' +
      '• Spike fade asset chips, and that asset On (Cushions tab on/off). Empty chips = no Spike fade buys\n' +
      '• Start after / Until minute (default minutes 2–6 of the 15m window)\n' +
      '• Expensive min/max and Cheap min/max — both sides must sit in those bands\n' +
      '• Always buys the cheap side (not Auto lean)\n' +
      '• Take ask (cheap bid ≥), Stop ask (cheap ask ≤), Flatten left, Lot contracts\n' +
      '• Shared: max open, trades/day, daily loss stop, window cap 1\n' +
      '• IOC. 1-second watcher from fill for take / stop / flatten\n\n' +
      'Does not use\n' +
      '• Auto $ per trade (size is Lot contracts × live ask)\n' +
      '• Auto max ask, Smart buy, chase, Auto TIF, Auto lean\n' +
      '• Gold fade gap / take-from-fill. Gold fade stays Gold-only and separate\n' +
      '• Protect, Cash out, TWAP $0 lock, Last-minute clips, Step buy lots, Home Sell\n' +
      '• Skip thin bid unless you turn that checkbox On (default Off). On = fail closed on buy; can dump if the bid pile is thinner than you hold\n\n' +
      'Isolation\n' +
      '• Own path. Default Off. Admin must enable the block first\n' +
      '• Example: YES $0.78 and NO $0.22 → buy NO. YES $0.82 or NO $0.18 → sit out\n' +
      '• One lot per ticker per window. Never YES and NO on the same ticker\n' +
      '• 5s grace after fill so your own print does not stop you out\n' +
      '• Take: cheap bid ≥ Take ask. Stop: cheap ask ≤ Stop ask. Flatten: minutes left ≤ Flatten left, or window end. Always dumps — no hold to $1\n' +
      '• After Until minute, no new Spike fade buys. An open lot still take / stop / flatten\n' +
      '• While On for that chip and inside Start after…Until minute, Auto / Cash out / Gold fade do not enter that ticker\n' +
      '• After Until minute with no lot, those paths may use the coin again (window cap 1 still applies)\n' +
      '• Open Spike fade: Home / Auto / Cash out / Gold fade / Last-minute / Step buy / Pair lock sit out that ticker\n' +
      '• If Last-minute is in its buy window and Spike fade has no lot, Last-minute owns new buys\n' +
      '• If TWAP lock is On for BTC/ETH, those two stay with TWAP\n' +
      '• Protect skips Spike fade rows',
  },
  pairLock: {
    title: 'Pair lock',
    body:
      'Uses\n' +
      '• Pair lock asset chips, and that asset On (Cushions tab on/off). Empty chips = no Pair lock buys\n' +
      '• Start after / Until minute (default minutes 2–10 of the 15m window)\n' +
      '• Runner max ask, Min lock, Flatten unmatched, Lot contracts\n' +
      '• Auto lean for the runner only. Hedge is always the other side\n' +
      '• Shared: max open, trades/day, daily loss stop, window cap 1 on the runner\n' +
      '• IOC. 1-second watcher from the runner fill for hedge / flatten unmatched\n\n' +
      'Does not use\n' +
      '• Auto $ per trade (size is Lot contracts × live ask)\n' +
      '• Auto max ask, Smart buy, chase, Auto TIF, Cushions $ gap\n' +
      '• Take / stop on a locked pair. A completed pair holds to settlement\n' +
      '• Protect, Cash out, Gold fade, TWAP $0 lock, Last-minute clips, Step buy lots, Spike fade, Home Sell\n' +
      '• Skip thin bid unless you turn that checkbox On (default Off). On = fail closed on buys; unmatched flatten can dump if the bid pile is thinner than you hold\n\n' +
      'Isolation\n' +
      '• Own path. Default Off. Admin must enable the block first\n' +
      '• Example: buy YES at 52¢, later buy NO at 18¢. Spent 70¢. Settlement pays $1. Locked +30¢\n' +
      '• Hedge only when runner fill + opposite ask ≤ $1 − Min lock (default 5¢). 50¢ + 50¢ sits out\n' +
      '• Hedge count matches the runner. Window cap 1 blocks the runner only\n' +
      '• 5s grace after the runner fill so your own print does not dump you\n' +
      '• Pair complete → hold both to $1. Flatten unmatched: minutes left ≤ Flatten unmatched, or window end, and only if the second leg is missing\n' +
      '• After Until minute, no new runner. An open runner may still hedge until flatten\n' +
      '• While On for that chip and inside Start after…Until minute, Auto / Cash out / Gold fade do not enter that ticker\n' +
      '• After Until minute with no runner, those paths may use the coin again (window cap 1 still applies)\n' +
      '• Open runner or open pair: Home / Auto / Cash out / Gold fade / Last-minute / Step buy / Spike fade sit out that ticker\n' +
      '• If Last-minute is in its buy window and Pair lock has no runner and no pair, Last-minute owns new buys\n' +
      '• If TWAP lock is On for BTC/ETH, those two stay with TWAP\n' +
      '• Spike fade and Step buy take first pick for new buys when they want the ticker\n' +
      '• Protect skips Pair lock rows',
  },
} as const;
