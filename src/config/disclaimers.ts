/**
 * Canonical risk / liability copy for Predict.
 * Keep docs/*.html in sync when changing these strings.
 * Bump DISCLAIMER_VERSION whenever SHORT/LONG text changes materially.
 */

/** Version tag stored with on-device Auto-trade risk acceptance records. */
export const DISCLAIMER_VERSION = '2026-09-10.1';

/** Shared note: Protect money is independent of Auto-trade (Legal + kill switch). */
export const PROTECT_MONEY_RUNS_WHEN_AUTO_TRADE_OFF =
  'Protect money works whenever that switch is On and keys are saved — even if Auto-trade (new buys) is Off. Exits run 24/7 on Cloud Run.';

/** Short banner for paywall, Home, Settings, and web footers. */
export const DISCLAIMER_SHORT =
  'Trading involves risk of loss. Predict does not guarantee profits or successful trades — whether you use alerts, Auto-trade, Home Buy / Sell taps, or any mix. You alone are responsible for trades you place yourself on Kalshi from an alert, trades Cloud Run places when Auto-trade is On, and trades Cloud Run places when you tap Buy or Sell on Home. The app owner is not liable for your losses.';

/** Longer text for Legal section / help modals. */
export const DISCLAIMER_LONG = [
  'Predict is an independent software tool that provides lean signals, alerts, optional automated order placement, and optional Home Buy / Sell taps using your own Kalshi API credentials.',
  'Predict is not affiliated with, endorsed by, sponsored by, or associated with Kalshi, Inc. or any of its subsidiaries.',
  'Nothing in this app is financial, investment, legal, or trading advice. Predict is not a broker, investment adviser, or money manager and owes no fiduciary duty to users. Prediction markets are speculative and you can lose some or all of the capital you risk.',
  'We do not promise, represent, or guarantee that any trade, alert, signal, tap, or strategy will succeed or produce a profit. Past results do not predict future results.',
  'You are solely responsible for all actions: if you place trades on Kalshi because of a Predict alert; if you enable Auto-trade so Cloud Run may place orders for you; or if you tap Buy or Sell on Home so Cloud Run places an order now. Those decisions and financial outcomes are yours alone.',
  'Home Buy / Sell: one tap tells Cloud Run to place now. The phone never talks to Kalshi. Auto-trade Off does not block a tap. A tap skips Auto-trade timing rules (min minutes left, min minutes elapsed, max entry ask) so you can buy even when the robot would skip as too early, too late, or ask too rich. Size, caps, cushion, window lock, chase-above-ask, and Time in force (Manual buy) still apply. Chase can make you pay a little more than the visible ask (up to $0.99). GTC can leave a resting order on Kalshi until fill or cancel. IOC / FOK can miss and you get no position. You can lose the full notional if the contract settles against you. Kill Switch and the Last signals Buy / Sell flag hide and disable these taps.',
  'Automated trading and Home taps rely on third-party exchange APIs, price feeds, network connectivity, cloud servers, and device operating systems. The app owner and developer are not responsible for any losses caused by Kalshi API downtime, rate limits, execution delays, slippage, market halts, feed errors, device suspensions, or network outages.',
  'Protect Sell & Early Exit Risks: The "Protect Sell" (early sell) feature attempts to exit open positions early when signals flip. However, Predict does NOT guarantee that an early sell will succeed, prevent losses, or save capital as expected. Early sell orders may fail, partial-fill, delay, or execute at worse-than-expected prices due to network traffic, API latency, order book illiquidity, wide bid-ask spreads, rapid price gapping, or time decay (theta) near contract expiration. You may still experience a total loss of invested capital.',
  PROTECT_MONEY_RUNS_WHEN_AUTO_TRADE_OFF,
  'You are solely responsible for keeping your Kalshi API credentials confidential and for reporting and paying any applicable local, state, or federal taxes resulting from your trading activities.',
  'Predict is intended only for individuals who are at least 18 years of age (or legal age in your jurisdiction) and who reside in locations where prediction market trading is legal.',
  'By using Predict, you agree to indemnify and hold harmless the app owner, developer, and operators from any claims, losses, or damages arising from your use of the application or your Kalshi account activity.',
].join('\n\n');

export const DISCLAIMER_TITLE = 'Important risk disclaimer';
