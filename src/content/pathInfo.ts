/** Risk i-icon copy: uses / does not use / isolation. Shown in Alert.alert. */

export const PATH_INFO = {
  shared: {
    title: 'Shared limits',
    body:
      'Uses\n' +
      '• Max open positions\n' +
      '• Max trades / day\n' +
      '• Max trades / asset / 15m window\n' +
      '• Daily loss stop\n\n' +
      'Applies to Home Buy and every Auto path (Auto-trade, Cash out, Gold fade, TWAP lock, Last-minute).\n\n' +
      'Does not use\n' +
      '• Cushions (Cushions tab)\n' +
      '• Asset on/off (Cushions tab)\n' +
      '• Path-only fields (ask, minutes, Protect, Smart buy)',
  },
  home: {
    title: 'Home Buy',
    body:
      'Uses\n' +
      '• This tab’s $ per trade / min / max\n' +
      '• Minutes left and elapsed\n' +
      '• Home max entry ask, TIF, chase\n' +
      '• Shared limits, cushions, asset on/off\n\n' +
      'Does not use\n' +
      '• Auto max ask, Auto TIF, Auto chase\n' +
      '• Smart buy\n' +
      '• Cash out / Gold fade / TWAP lock / Last-minute fields\n\n' +
      'Isolation\n' +
      '• A tap still spends real money even if Auto-trade is Off\n' +
      '• Will not buy a ticker Cash out, Gold fade, TWAP lock, or Last-minute already holds\n' +
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
      '• Cushions, Smart buy (if On), shared limits, asset on/off\n\n' +
      'Does not use\n' +
      '• Home Buy size/timing\n' +
      '• Cash out / Gold fade / TWAP / Last-minute ask or side\n\n' +
      'Isolation\n' +
      '• Default minutes left = 2, so Auto sits out the last minute\n' +
      '• If you set minutes left to 0, Auto can collide with Last-minute (window cap 1 wins)\n' +
      '• Will not enter a ticker another path already holds\n' +
      '• BTC/ETH leave Auto while TWAP lock is On for those chips',
  },
  smartBuy: {
    title: 'Smart buy',
    body:
      'Uses\n' +
      '• Auto-trade only (Home Buy ignores it)\n' +
      '• Cushion, minutes, Auto max ask, shared caps — then also Min extra chance\n\n' +
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
      '• Can exit Auto and Home fills\n' +
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
      '• Checked Cash out assets, Enter cushion %, Cash out max ask / bid / stop\n' +
      '• This path’s Skip thin bid checkbox\n' +
      '• $ per trade and shared caps\n' +
      '• Minutes left floor of 3 (never last-minute)\n\n' +
      'Does not use\n' +
      '• Auto max ask, Smart buy, chase, Protect\n' +
      '• Gold fade / TWAP / Last-minute fields\n\n' +
      'Isolation\n' +
      '• Checked coins use Cash out instead of normal Auto\n' +
      '• Never shares a ticker with Home, fade, TWAP, or Last-minute\n' +
      '• BTC/ETH leave Cash out while TWAP lock is On for those chips\n' +
      '• Does not last-minute chase — Last-minute can still use the same coin if this window is empty',
  },
  goldFade: {
    title: 'Gold fade',
    body:
      'Uses\n' +
      '• Gold only\n' +
      '• Max gap, max cheap ask, take, stop, flatten minutes\n' +
      '• $ per trade, shared caps, this path’s Skip thin bid\n\n' +
      'Does not use\n' +
      '• Auto max ask, Smart buy, Protect, Cash out bid/stop\n' +
      '• TWAP lock / Last-minute fields\n' +
      '• Cushions to enter (gap must be small; full cushion flips the exit)\n\n' +
      'Isolation\n' +
      '• Never shares a ticker with Home, Auto, or Cash out\n' +
      '• Flatten default 3 minutes left — not a last-minute chase\n' +
      '• Always dumps (take / stop / flatten / window end)',
  },
  twapLock: {
    title: 'TWAP lock',
    body:
      'Uses\n' +
      '• BTC / ETH chips, this path’s max ask\n' +
      '• $ per trade, window cap 1, shared caps\n' +
      '• This path’s Skip thin bid (fail closed if book size unknown)\n' +
      '• IOC, 1-second CF Benchmarks watch in the last 60s\n' +
      '• $0 leftover lock only (banked ≥ strike × 60), Yes only\n\n' +
      'Does not use\n' +
      '• Cushions, Auto max ask, Smart buy, chase, minutes left/elapsed\n' +
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
      '• Checked Last-minute assets that are also On in Cushions\n' +
      '• This path’s entry ask and Yes / No / Both\n' +
      '• $ per trade, window cap 1, shared caps\n' +
      '• This path’s Skip thin bid, IOC, 1-second watch in the last 60s\n\n' +
      'Does not use\n' +
      '• Cushions\n' +
      '• Auto max ask, Smart buy, chase, minutes left/elapsed, Auto TIF\n' +
      '• Protect, Cash out, Gold fade, TWAP $0 lock, Home Sell\n\n' +
      'Isolation (true restrictions)\n' +
      '• Does not pull coins off Cash out or Auto — those paths already sit out the last minute\n' +
      '• Window cap 1: if Auto or Cash out already filled this coin this window, Last-minute sits out\n' +
      '• If TWAP lock is On for BTC/ETH, those two stay with TWAP in the last minute\n' +
      '• Both = last-minute favorite only (not a 50/50). Never Yes and No in the same window\n' +
      '• Hold to settlement — no Protect / Cash out / fade / Home Sell exit\n' +
      '• Not a lock. Last seconds can flip. You can lose the full entry ask',
  },
} as const;
