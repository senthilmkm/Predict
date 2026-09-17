# Last-minute — design

Status: **implemented**. Admin + user default Off. Sits **next to** TWAP lock. Does not replace it.

Product name: **Last-minute**  
Firestore / code keys: `lastMinute` (admin), `last_minute_*` (user risk), `entry_path: 'last_minute'`

Buy Yes, No, or the last-minute favorite in the last 60 seconds if that side’s ask is at or under this path’s **entry ask**. Hold to settlement. **Not** a $0 lock.

---

## Feature flag (Admin)

Firestore `system/config.featureFlags.lastMinute`. Default **false** (`=== true` only).

Phone shows the Risk block only when this is true. Cloud may 1s-watch and enter only when Admin + user are On.

---

## User settings (Risk → Auto-trade)

| Risk key | UI | Default |
|---|---|---|
| `last_minute_enabled` | toggle | false |
| `last_minute_max_ask_usd` | Entry ask | **$0.96** (0.80–0.99) |
| `last_minute_side` | Yes / No / Both (one line, 3 checkboxes, one selected) | **yes** |

Any asset the user has On. No separate chip row.

**Both:** buy the higher-ask side only if that ask is a last-minute favorite (ask ≥ $0.90 or the entry ask if lower, and the two asks differ by at least 10¢). 50/50 sits out. Never Yes and No in the same window.

---

## Isolation (true restrictions)

- Does **not** pull coins off Cash out or Auto. Those paths already sit out the last minute (Cash out floor 3 min left; Auto default 2).
- **Window cap 1:** if Auto or Cash out already filled this coin this window, Last-minute sits out.
- If **TWAP lock** is On for BTC/ETH, those two stay with TWAP. Last-minute does not fight the lock.
- Hold to settlement. Protect / Cash out / fade / Home Sell do not exit these lots.

---

## Uses / does not use

**Uses:** $ per trade, window cap 1, shared caps, skip thin bid, IOC, this path’s entry ask, Yes/No/Both, enabled assets, 1s watch in the last 60s.

**Does not use:** cushions, Auto max ask, Smart buy, chase, minutes left/elapsed, Auto TIF, Protect, Cash out, Gold fade, TWAP $0 lock, Home Sell.

---

## Locked: Late ATR cushion

Status: **implemented**. Last-minute **only**. Home Buy, Cushion lean, and other paths **out of scope**.

### Why

A high ask in the final seconds prices “almost sure,” but a lead smaller than normal 1‑minute noise is still a trap. Require lead ≥ a multiple of this window’s 1‑minute ATR before buying expensive late tickets.

### When the gate runs

All of the following must be true (after side pick, before place):

1. Last-minute would otherwise place (Admin + user On, enter window, stop window, clips, Both, shared caps, etc.)
2. **Seconds left ≤ 60** (final minute only — not the full enter window, e.g. 90s)
3. **Chosen side’s ask ≥ high-ask floor** (default **88¢**)

If ask is under the floor, or more than 60s remain → gate does **not** run.

### Lead (cushion)

Use **signed lead on the bought side**, not raw `|gap|`:

- YES → `live − strike`
- NO → `strike − live`

If lead ≤ 0 (wrong side / on the line) → **SKIP** when the gate is active.

### 1‑minute ATR (constructed)

Source: Kalshi `live_data` timeseries already on the lean (`{ t, v }` spot ticks for this 15m event). No external ATR feed. No exchange OHLC required.

Method:

1. Bucket ticks into **1‑minute bars** (high = max `v`, low = min `v`, close = last `v` in the minute)
2. True range per bar = `max(high−low, |high−prevClose|, |low−prevClose|)`
3. ATR = **simple mean** of the last **N** true ranges (**N = 14**; if fewer complete bars, use what exists with a **minimum of 5** bars)

This is a tick-built ATR, not TradingView candle ATR. Good enough for noise vs lead.

### Pass / skip

```
need = atr_mult × ATR
pass if lead ≥ need
```

| Case | Action | Skip reason |
|---|---|---|
| lead ≥ need | continue Last-minute | — |
| lead &lt; need | SKIP | `last_minute_atr_thin` → “lead thinner than 1m noise” |
| gate active but ATR unavailable (&lt;5 bars or no path) | **allow** (do not veto) | — |

> Note: an earlier draft skipped on no-path; that blocked almost all Last-minute clips when live path was missing on the 1s lean. Shipped behavior is allow when ATR cannot be measured.

### Settings (Paths → Last-minute)

| Risk key | UI | Default | Range |
|---|---|---|---|
| `last_minute_atr_cushion_enabled` | Late ATR cushion | **On** (`!== false`) | On / Off |
| `last_minute_atr_ask_usd` | High ask floor | **$0.88** | 0.80–0.95 |
| `last_minute_atr_mult` | Lead ≥ ATR × | **1.25** | 1.00–1.50 (step 0.05) |

Fixed (not knobs): window **60s**, ATR period **14**, min bars **5**, SMA of true ranges.

### Isolation for this gate

- Does **not** change Cushion lean “Skip if gap ≥ cushion ×”
- Does **not** replace Smart buy (Last-minute already ignores Smart buy)
- Does **not** apply to Home Buy or any other path in v1
- Off = Last-minute behaves as today (no ATR check)

### Example (locked numbers)

WTI strike $72.00, 1m ATR $0.08, mult 1.25 → need **$0.10**, ask 90¢, T−55s:

- live $72.03 (lead $0.03) → **SKIP**
- live $72.12 (lead $0.12) → **BUY** (other Last-minute gates still apply)
