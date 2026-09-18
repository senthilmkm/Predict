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
      'Applies to Home Buy and every Auto path (Auto-trade, Cash out, Gold fade, TWAP lock, Last-minute first clip, Step buy lot 1, Spike fade, Pair lock runner, Cheap loop).\n\n' +
      'Does not use\n' +
      '• Cushions $ gap (Cushions tab)\n' +
      '• Asset on/off (Cushions tab)\n' +
      '• Path-only fields (ask, minutes, Protect, Smart buy, Last-minute clips)\n\n' +
      'Isolation\n' +
      '• Max trades / day counts each filled buy. A sell of that fill does not add another. IOC misses do not count\n' +
      '• Window cap 1 is one fill per coin per 15m window for Home / Auto / Cash out / fade / TWAP / Last-minute first clip / Step buy lot 1 / Spike fade / Pair lock runner. Cheap loop uses Cycles instead\n' +
      '• Last-minute ladder clips after that first Last-minute fill are extra (up to Max clips/asset)\n' +
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
      '• Enter when gap ≥ cushion × (default 1×; Home-only scale of Cushions $)\n' +
      '• Sell at % take-profit (0 = Off; 1s mark watch; Protect wait/grace)\n' +
      '• Home Buy asset chips, and that asset On (Cushions). Empty chips = no Home taps\n' +
      '• Shared limits\n' +
      '• Cushions $ gap and asset on/off (Cushions tab)\n\n' +
      'Does not use\n' +
      '• Auto max ask, Auto TIF, Auto chase\n' +
      '• Smart buy / Cushion lean Enter × or Skip × / Cushion lean chips\n' +
      '• Cash out / Gold fade / TWAP lock / Last-minute fields\n\n' +
      'Isolation\n' +
      '• A tap still spends real money even if Auto-trade is Off\n' +
      '• Enter × scales this tab only — Cushion lean keeps its own Enter ×\n' +
      '• Asset chips are Home-only — Cushion lean keeps its own chips\n' +
      '• One Buy only for the lean side when gap clears Enter × cushion — no opposite Buy after a fill\n' +
      '• Will not buy a ticker Cash out, Gold fade, TWAP lock, Last-minute, Step buy, Spike fade, Pair lock, or Cheap loop already holds\n' +
      '• A Home fill counts toward window cap 1 (Last-minute first clip then sits out)\n' +
      '• Protect money can later sell a Home fill (if Protect is On)\n' +
      '• Sell at % can dump a Home fill without a lean flip\n' +
      '• Home Sell is IOC; marketable limit uses bid − Home slip (chase)',
  },
  auto: {
    title: 'Cushion lean',
    body:
      'Uses\n' +
      '• This path’s $ per trade / min / max\n' +
      '• Minutes left and elapsed (default 2 / 2 — no last-minute chase)\n' +
      '• Auto max entry ask, TIF, slip (chase) — marketable limit at live ask + slip on send\n' +
      '• Sell at % take-profit (0 = Off; 1s mark watch; Protect wait/grace)\n' +
      '• Cushions $ gap (above cushion × enter, below cushion × max gap), Smart buy (if On), shared limits, asset on/off\n' +
      '• Cushion lean asset chips (empty = no Cushion lean buys; asset must also be On in Cushions)\n\n' +
      'Does not use\n' +
      '• Home Buy size/timing / Home chips\n' +
      '• Cash out / Gold fade / TWAP / Last-minute / Step buy / Spike fade / Pair lock / Cheap loop ask, side, or lots\n\n' +
      'Isolation\n' +
      '• Off = Cloud skips gap>cushion buys only. Last-minute and other paths keep their own switches\n' +
      '• Enter when gap ≥ cushion × (default 1×) scales Auto enter without changing Cushions $ — Home Buy ignores it\n' +
      '• Skip if gap ≥ cushion × (default 2.5) sits out stretched moves — Home Buy ignores it\n' +
      '• Asset chips are Cushion lean only — Home Buy keeps its own chips\n' +
      '• Settings Auto-trade Off still stops every Auto path\n' +
      '• Missing on old configs = On\n' +
      '• Default minutes left = 2, so Auto sits out the last minute\n' +
      '• If cushion already hit, this is the path — you do not need Last-minute on that coin\n' +
      '• If you set minutes left to 0, Auto can collide with Last-minute (window cap 1 wins)\n' +
      '• Will not enter a ticker another path already holds\n' +
      '• BTC/ETH leave Auto while TWAP lock is On for those chips\n' +
      '• Sell at % dumps Auto fills on mark profit — independent of Protect lean-flip',
  },
  smartBuy: {
    title: 'Smart buy',
    body:
      'Uses\n' +
      '• Cushion lean only (Home Buy ignores it)\n' +
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
      '• Skips Step buy, Spike fade, Pair lock, and Cheap loop rows — those paths stop themselves\n' +
      '• IOC sell; slippage from Auto chase\n' +
      '• Wait after fill / grace is also used by Home Buy and Cushion lean Sell at %\n\n' +
      'Does not use\n' +
      '• Minutes left / elapsed (after the wait, any time left)\n' +
      '• Cash out / Gold fade / TWAP lock / Last-minute lots — those paths hold or exit themselves\n' +
      '• Sell at % (separate Home / Cushion lean knobs; independent of lean-flip)\n\n' +
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
      '• Slip (chase above ask) — Cash out–only marketable buy/sell slip\n' +
      '• This path’s Skip thin bid (sells into the bid — thin book matters here)\n' +
      '• This path’s $ per trade / min / max (missing seeds from Cushion lean $)\n' +
      '• Shared caps\n' +
      '• Minutes left floor of 3 (never last-minute)\n\n' +
      'Does not use\n' +
      '• Cushion lean $ after this path has its own $ saved\n' +
      '• Auto max ask, Auto slip, Smart buy, Protect\n' +
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
      '• This path’s $ per trade / min / max (missing seeds from Cushion lean $)\n' +
      '• Shared caps\n' +
      '• This path’s Skip thin bid (sells the lot — thin book matters here)\n\n' +
      'Does not use\n' +
      '• Cushions $ to enter (gap must be small)\n' +
      '• Cushion lean $ after this path has its own $ saved\n' +
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
      '• This path’s $ per trade / min / max (missing seeds from Cushion lean $)\n' +
      '• Window cap 1, shared caps\n' +
      '• This path’s Skip thin bid checkbox (default Off)\n' +
      '• IOC, 1-second CF Benchmarks watch in the last 60s\n' +
      '• $0 leftover lock only (banked ≥ strike × 60), Yes only\n\n' +
      'Does not use\n' +
      '• Cushions $ gap\n' +
      '• Cushion lean $ after this path has its own $ saved\n' +
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
      '• Watch start, First clip by, Stop with, Ladder wait, Clip contracts/asset, Max clips/asset\n' +
      '• Sell if flip ≥ (0 = Off). Sells a lot only when the other side is that much richer\n' +
      '• Late ATR cushion (default On): in the final 60s at High ask floor (default 88¢), needs signed lead ≥ ATR × (default 1.25) from this window’s 1m path when measurable; missing path does not block\n' +
      '• Shared: max open, trades/day, daily loss stop\n' +
      '• Window cap 1 for the first clip only\n' +
      '• IOC, 1-second quotes from Watch start\n\n' +
      'Does not use\n' +
      '• Cushions $ gap. If the gap already reached cushion, play Auto / Home / Cash out — not this path\n' +
      '• Auto $ per trade (size is Clip contracts/asset × live ask)\n' +
      '• Auto max ask, Smart buy, chase, minutes left/elapsed, Auto TIF\n' +
      '• Protect, Cash out, Gold fade, TWAP $0 lock, Home Sell\n' +
      '• Skip thin bid unless you turn that checkbox On (default Off — 1-contract IOC just misses if the book is thin)\n\n' +
      'Isolation\n' +
      '• Leftover path when the cushion thesis never showed\n' +
      '• Does not pull coins off Cash out or Auto — those paths already sit out the last minute\n' +
      '• Window cap 1: if Auto, Home, or Cash out already filled this coin this window, the first clip sits out\n' +
      '• After that first Last-minute fill, ladder adds are extra (up to Max clips/asset of open lots)\n' +
      '• A flip sell frees that clip slot so the path can buy the new favorite\n' +
      '• Late ATR cushion is Last-minute only (Home / Cushion lean ignore it)\n' +
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
      '• Cushion % of that coin’s Cushions $ — lot 1, and the dump when Sell if thesis dies is On\n' +
      '• Add cushion % — lots 2+ only (default 75%, never below Cushion %)\n' +
      '• Lot contracts (size of each lot), Add wait, Add band (lots 2+ only), Max lots, Stop, Entry ask\n' +
      '• Sell if thesis dies (default On) — dump the stack at the live bid if gap < Cushion % or lean flips\n' +
      '• Shared: max open, trades/day, daily loss stop\n' +
      '• Window cap 1 for lot 1 only\n' +
      '• IOC. 1-second bid/ask watch from the first fill (stops + thesis dump). After Max lots the watcher is exit-only\n\n' +
      'Does not use\n' +
      '• Auto $ per trade (size is Lot contracts × live ask)\n' +
      '• Auto max ask, Smart buy, chase, minutes left, Auto TIF\n' +
      '• Full cushion — only Cushion % / Add cushion % of the $ gap\n' +
      '• Protect, Cash out, Gold fade, TWAP $0 lock, Last-minute clips, Home Sell\n' +
      '• Skip thin bid unless you turn that checkbox On (default Off)\n\n' +
      'Isolation\n' +
      '• Own path. Default Off. Admin must enable the block first\n' +
      '• Follows the Auto lean (YES or NO). Never both sides on one ticker\n' +
      '• Lot 1 only after Start after + Cushion % + lean + Entry ask\n' +
      '• Later lots need Add wait, Add cushion % + lean still with you, and ask between last fill and last fill + Add band\n' +
      '• Add band 0 = next ask must match the last fill. Band does not apply to lot 1\n' +
      '• If the ask has already run past last fill + Add band, Cloud waits for it to come back — it does not chase. Widen the band (up to 10¢) if you still want that add after a jump\n' +
      '• Stop adding with 30s left (code, not a knob). Stops and thesis dump still run in those last 30s\n' +
      '• 5s grace after each fill so your own print does not stop you out\n' +
      '• Sell a lot when live ask ≤ that lot’s fill − Stop ¢. Sell is bid IOC from the 1s live book\n' +
      '• Lot 1 stop sells every remaining Step buy lot on that ticker\n' +
      '• Sell if thesis dies On: gap under Cushion % or lean flip also dumps every remaining lot at the live bid\n' +
      '• Sold lots free Max lots slots (open lots only)\n' +
      '• Window cap 1: Auto / Home / Cash out fill this window blocks lot 1. Later Step buy lots are extra\n' +
      '• Open Step buy: Auto / Home / Cash out / Last-minute / Pair lock / Cheap loop sit out that ticker\n' +
      '• If Last-minute is in its buy window and Step buy has no lots yet, Last-minute owns new buys\n' +
      '• If TWAP lock is On for BTC/ETH, those two stay with TWAP\n' +
      '• Protect skips Step buy rows\n' +
      '• Hold to settlement unless a stop or thesis dump already fired',
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
      '• Open Spike fade: Home / Auto / Cash out / Gold fade / Last-minute / Step buy / Pair lock / Cheap loop sit out that ticker\n' +
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
      '• Runner max ask, Min lock, Flatten unmatched, Recover wait, Runner stop, Lot contracts, Add new pair\n' +
      '• Lock first checkbox (default On). Off = more first legs at/under Runner max without the opposite already locking\n' +
      '• Auto lean for the runner only. Hedge is always the other side\n' +
      '• Shared: max open, trades/day, daily loss stop, window cap 1 on the runner\n' +
      '• IOC. 1-second watcher from the runner fill for hedge / runner stop / flatten unmatched. After both legs lock, that watcher stays on if Add new pair > 0 and can fire YES+NO on the hedge-fill pulse and every 1s\n\n' +
      'Does not use\n' +
      '• Auto $ per trade (size is Lot contracts × live ask)\n' +
      '• Auto max ask, Smart buy, chase, Auto TIF, Cushions $ gap\n' +
      '• Take / stop on a locked pair. A completed pair holds to settlement\n' +
      '• Protect, Cash out, Gold fade, TWAP $0 lock, Last-minute clips, Step buy lots, Spike fade, Home Sell\n' +
      '• Skip thin bid unless you turn that checkbox On (default Off). On = fail closed on buys; unmatched flatten can dump if the bid pile is thinner than you hold\n\n' +
      'Isolation\n' +
      '• Own path. Default Off. Admin must enable the block first\n' +
      '• Example: YES 52¢ and NO 18¢ already lock → YES and NO IOC together. Spent 70¢. Settlement pays $1. Locked +30¢\n' +
      '• Lock first On: first buy only if opposite ask already locks at least Min lock (default 5¢). Then YES and NO IOC together. 52¢ + 48¢ sits out. 50¢ + 50¢ sits out\n' +
      '• Lock first Off: first buy if runner ask ≤ Runner max. If the other ask already locks Min lock, still both IOC together. Else runner only\n' +
      '• Atomic one-leg miss: wait Recover wait (hedge / take / smaller dump). Do not dump on the first tick\n' +
      '• Hedge when runner fill + opposite ask ≤ $1 − Min lock. Hedge count matches the runner. Window cap 1 blocks the runner only\n' +
      '• Recover wait (default 20s, 10–60): after an unmatched runner, if Min lock hedge is gone: buy the dog only if fill + ask ≤ 99¢, else sell the runner if bid ≥ fill + 2¢, else finish vs dump — finish only when that hole is strictly smaller\n' +
      '• Hedge right after the runner fill. 5s grace is for flatten / runner stop / recover take so your own print does not dump you\n' +
      '• Add new pair 0–3 (default 0 = first pair only). 3 = 3 more pairs after the first (4 total)\n' +
      '• After both first-pair legs fill, if Add new pair > 0 and live YES+NO asks still lock Min lock, Cloud fires YES and NO together on that pulse and every 1s\n' +
      '• If only one stacked side fills, compare finish vs dump and take the smaller loss. Do not sit unmatched\n' +
      '• Pair complete → hold both to $1. Flatten unmatched: minutes left ≤ Flatten unmatched, or window end, and only if the second leg is missing\n' +
      '• Runner stop (default 10¢, $0 = off): unmatched only, after 5s grace, and only if the hedge still cannot lock. Sells when live runner ask ≤ fill − Runner stop. Sell is bid IOC — the book can gap past 10¢. After that sell we do not buy the other leg on this ticket\n' +
      '• After Until minute, no new runner. An open runner may still hedge until flatten\n' +
      '• While On for that chip and inside Start after…Until minute, Auto / Cash out / Gold fade do not enter that ticker\n' +
      '• After Until minute with no runner, those paths may use the coin again (window cap 1 still applies)\n' +
      '• Open runner or open pair: Home / Auto / Cash out / Gold fade / Last-minute / Step buy / Spike fade / Cheap loop sit out that ticker\n' +
      '• If Last-minute is in its buy window and Pair lock has no runner and no pair, Last-minute owns new buys\n' +
      '• If TWAP lock is On for BTC/ETH, those two stay with TWAP\n' +
      '• Spike fade and Step buy take first pick for new buys when they want the ticker\n' +
      '• History Sell on a pending Pair lock (or hedge) fill dumps that leg now (bid IOC). Allowed with Auto Off and Kill switch\n' +
      '• Protect skips Pair lock rows',
  },
  capLock: {
    title: 'Cap lock',
    body:
      'Uses\n' +
      '• Cap lock asset chips, and that asset On (Cushions tab on/off). Empty chips = no Cap lock buys. Every 15m catalog chip is listed\n' +
      '• Max lock loss (default 5¢/pair, 1–8¢), Try first (default 90s, 30–180), Allow later, Lot contracts (1–5)\n' +
      '• Live YES ask + NO ask + Kalshi fees must fit $1 + Max lock loss. No lean. No cushion. No spot vs strike\n' +
      '• Shared: max open, trades/day, daily loss stop. Window cap 1 does not block this path — one pair is one action\n' +
      '• IOC only. Richer ask first. Second size = first fill count. Unmatched leftover flattens. Matched pair holds to $1\n\n' +
      'Does not use\n' +
      '• Auto lean, Auto $, Smart buy, chase, Auto TIF, Cushions $ gap\n' +
      '• Pair lock runner / hedge / stack / recover / min lock profit\n' +
      '• Cheap loop, Cash out, Gold fade, TWAP, Last-minute, Spike fade, Step buy exits on a matched pair\n\n' +
      'Isolation\n' +
      '• Own path. Default Off. Admin must enable the block first\n' +
      '• Example: 50¢ + 50¢ + ~4¢ fees → about −4¢ → buy both if Max lock loss is 5¢. 52¢ + 52¢ sits. 60¢ + 60¢ sits\n' +
      '• One pair per ticker per window. A sent IOC (including a 0-fill) burns the attempt. Sitting out because the book is rich does not\n' +
      '• Prefer Try first. Allow later On: still enter once if the book later fits\n' +
      '• First IOC 0 fill → do not send the second. Second miss: one retry only if leftover still fits the cap, else flatten. Never add more of the filled side\n' +
      '• When On for that chip, Cushion Auto lean sits that coin. Pair lock / other open lots on the ticker sit Cap lock out\n' +
      '• History Sell stays hidden on a matched pair. Unmatched leftover can dump\n' +
      '• Protect / Cash out / Gold fade skip Cap lock rows\n' +
      '• If TWAP lock is On for BTC/ETH, those two stay with TWAP',
  },
  bufferRun: {
    title: 'Buffer run',
    body:
      'Uses\n' +
      '• BTC / ETH chips only, and that asset On (Cushions). Empty chips = no Buffer run buys\n' +
      '• Ask min / Ask max (default 42–62¢), Take (default +12¢), Stop (default −7¢)\n' +
      '• Sell at % take-profit (0 = Off; same mark rule as Cushion lean; Buffer run grace). Checked before Take ¢ — Sell at fires first if both could hit\n' +
      '• Enter after (default 3m), Enter left (default 5m), Flatten left (default 3m)\n' +
      '• ATR × (default 1.25) and BTC / ETH min gap floors ($40 / $2.50). Lead must clear max(floor, ATR×)\n' +
      '• $ per trade (default $2.50), Pair-sum skip (default 0.98 — sit when YES+NO looks like a lock)\n' +
      '• Shared: max open, trades/day, daily loss stop. One trade per ticker per window\n' +
      '• IOC. Exits: Sell at % (before Take), Take, Stop, lean flip, or Flatten. Never hold to $1\n\n' +
      'Does not use\n' +
      '• Auto lean $, Auto max ask, Smart buy, chase, Auto TIF, Cushions $ gap\n' +
      '• Cap lock / Pair lock / Cheap loop / Cash out / Gold fade knobs\n' +
      '• Skip thin bid unless you turn that checkbox On (default Off)\n\n' +
      'Isolation\n' +
      '• Own path. Default Off. Admin must enable the block first\n' +
      '• Example: BTC live $100 above strike, YES ask 55¢ → buy YES. If Sell at % hits first, that sell wins; else Take when bid ≥ fill + 12¢; dump if bid ≤ fill − 7¢ or lean flips; else flatten with ≤ 3m left\n' +
      '• One trade per ticker per window. A sent IOC (including a 0-fill) burns the attempt\n' +
      '• TWAP / Last-minute / Spike fade / Step buy / Pair lock / Cap lock / Cheap loop sit Buffer run out when they own the coin\n' +
      '• While Buffer run holds, those paths sit that ticker out\n' +
      '• Protect skips Buffer run rows\n' +
      '• If TWAP lock is On for BTC/ETH, those two stay with TWAP',
  },
  cheapLoop: {
    title: 'Cheap loop',
    body:
      'Uses\n' +
      '• Cheap loop asset chips, and that asset On (Cushions tab on/off). Empty chips = no Cheap loop buys\n' +
      '• Start after / Flatten left (15m defaults: after 2 minutes, dump with 5 minutes left)\n' +
      '• Cheap max ask, Min gap — buy only the cheaper YES or NO\n' +
      '• 15m hard band: cheap ask 20–40¢ and the other ask ≤ 80¢. 11¢ / 90¢ sits. Hourly and Weekly do not use this band\n' +
      '• Min live % — |live − strike| must be at least this % of that coin’s Cushions $ (15m only; 0 = off). Not one dollar for every chip\n' +
      '• Take (bid ≥ fill + Take), Stop (default Off; On = bid ≤ fill − Stop after Min hold), Min hold, Cooldown, Cycles, Lot contracts\n' +
      '• Shared: max open, trades/day, daily loss stop. Window cap 1 does not block this path — Cycles is the cap\n' +
      '• IOC. 1-second watcher from fill for take / flatten, then cooldown re-entry\n\n' +
      'Does not use\n' +
      '• Auto $ per trade (size is Lot contracts × live ask)\n' +
      '• Auto max ask, Smart buy, chase, Auto TIF, Auto lean\n' +
      '• Cash out / Gold fade / Spike fade / Pair lock knobs\n' +
      '• Protect, Home Sell\n' +
      '• Skip thin bid unless you turn that checkbox On (default Off). On = fail closed on buy only\n\n' +
      'Isolation\n' +
      '• Own path. Default Off. Admin must enable the block first\n' +
      '• Example: YES 30¢ and NO 70¢ → buy YES. After Min hold, sell if the YES bid is fill + Take. Then cooldown. Then buy whichever side is cheaper\n' +
      '• 22¢ / 76¢ buys. 11¢ / 90¢ sits (dog already dead). 28¢ / 82¢ sits (favorite already decided)\n' +
      '• Cycles = completed exits this ticker this window. A miss or a sit-out does not burn a cycle\n' +
      '• Always dumps. Never both sides. Never hold to $1\n' +
      '• 5s grace after fill so your own print does not take you. Flatten and a $1 ask still dump during grace\n' +
      '• Stop default Off. On: after Min hold, dump bid IOC when that bid ≤ fill − Stop (5–12¢). Flatten and a $1 ask still dump during grace\n' +
      '• While On for that chip and inside Start after…Flatten left with Cycles left, Auto / Cash out / Gold fade do not enter that ticker\n' +
      '• Open Cheap loop, or cooldown with cycles left: Spike fade / Step buy / Pair lock sit out. Last-minute still owns new buys if Cheap loop has no lot\n' +
      '• Spike fade, Step buy, and Pair lock take first pick for a new buy when they want the ticker\n' +
      '• If TWAP lock is On for BTC/ETH, those two stay with TWAP\n' +
      '• Home tap or any other open fill blocks a new Cheap loop buy\n' +
      '• History Sell on a pending 15m fill dumps that ticker now (bid IOC). Allowed with Auto Off and Kill switch\n' +
      '• Protect skips Cheap loop rows\n' +
      '• Hourly is a second switch on this tile. It trades Kalshi above/below ATM strikes (KXBTCD, …), not the 15m book. Own chips, clocks, and Cycles per hour event. One open hourly lot per coin. 15m and Hourly may both hold. TWAP / Last-minute / Spike / Step / Pair stay on 15m',
  },
  cheapLoopHourly: {
    title: 'Cheap loop hourly',
    body:
      'Uses\n' +
      '• Hourly switch and hourly asset chips. Empty chips = no hourly buys. Asset must be On in Cushions\n' +
      '• Unique ATM strike on Kalshi above/below (KXBTCD, KXETHD, …). Tie sits out\n' +
      '• Start after / Flatten left (hourly defaults: after 10 minutes, dump with 5 minutes left)\n' +
      '• Cheap max, Min gap, Take, Stop (default Off), Min hold, Cooldown, Cycles per hour event, Lot contracts\n' +
      '• Shared: max open, trades/day, daily loss stop. Window cap 1 does not block\n\n' +
      'Does not use\n' +
      '• The 15m Cheap loop chips or clocks\n' +
      '• 15m tickers (KXBTC15M, …)\n' +
      '• TWAP / Last-minute / Spike / Step / Pair (those stay on 15m)\n\n' +
      'Isolation\n' +
      '• After fill, hold that strike until Take, Stop (if On), or Flatten. Do not hop ATM\n' +
      '• One open hourly lot per coin. 15m Cheap loop may also hold the 15m book\n' +
      '• History Sell on a pending hourly fill dumps that ticker now (bid IOC). Allowed with Auto Off and Kill switch\n' +
      '• Open lot still exits if Hourly is later turned Off\n' +
      '• Protect skips cheap_loop_hourly rows',
  },
  cheapLoopWeekly: {
    title: 'Cheap loop weekly',
    body:
      'Uses\n' +
      '• Weekly switch and weekly asset chips. Default BTC and ETH. Empty chips = no weekly buys. Asset must be On in Cushions\n' +
      '• Same KX*D series as Hourly. Cloud picks the live event whose open→close is 3–14 days (~7d week)\n' +
      '• Nearest ATM strike (picks one on a tie). After fill, hold that ticker until Take, Stop, Flatten, or History Sell\n' +
      '• Start after / Flatten left (default 2 hours, 30 min–12 hr) / Cheap max 45¢ / Min gap 8¢ / Take 8¢ / Stop On at 12¢ / Min hold / Cooldown (minutes). Cycles default 10 (max 50) per weekly event\n' +
      '• Shared: max open, trades/day, daily loss stop. Window cap 1 does not block\n\n' +
      'Does not use\n' +
      '• 15m or hourly Cheap loop chips or clocks\n' +
      '• 15m tickers\n' +
      '• TWAP / Last-minute / Spike / Step / Pair (those stay on 15m)\n' +
      '• Daily / monthly / annual ladders this pass\n\n' +
      'Isolation\n' +
      '• Buy cheap ATM → wait until bid ≥ fill + Take → sell → Cooldown minutes → hunt ATM again (ATM may move)\n' +
      '• Repeat until Flatten left of that weekly window. Flatten: no new buys; dump if holding\n' +
      '• Stop dumps after Min hold when bid ≤ fill − Stop\n' +
      '• One open weekly lot per coin. 15m / Hourly / Weekly may all hold (different tickers)\n' +
      '• History Sell on a pending hourly or weekly fill dumps that ticker now (bid IOC). Allowed with Auto Off and Kill switch\n' +
      '• Open lot still exits if Weekly is later turned Off\n' +
      '• Protect skips cheap_loop_weekly rows',
  },
} as const;
