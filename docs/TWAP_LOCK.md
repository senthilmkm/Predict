# TWAP lock — design (locked)

Status: **implemented**. Admin + user default Off. Do not turn the live Admin flag On until the CFB 1Hz adapter is proven on a settled KXBTC15M window.  
Do not loosen “total lock” in code or UI.  
Copy Cash out / Gold fade: **Admin flag Off** + **user toggle Off**. Both must be On to place.

Product name: **TWAP lock**  
Firestore / code keys: `twapLock` (admin), `twap_lock_*` (user risk), `entry_path: 'twap_lock'`

This is the only Predict path meant for **a few cents with arithmetic**, not a lean. It will **not** trade most windows.

---

## 1. What it is (locked)

Kalshi **crypto** 15m (v1: **BTC** and **ETH** only) settles on a **60-second average** of **CF Benchmarks Real-Time Index** prints, **one per second**, in the **last minute** before `close_time`. Yes if that close average is **at least** the official strike (the open 60s average). Tie → Yes.

**TWAP lock** buys the **Yes** ticket only when the running sum of those official 1-second prints already wins even if **every leftover second is $0**.

```
banked = sum of official RTI prints already in the last 60s window
YES is locked ⇔ banked >= strike × 60
```

Example: strike $100, magic number 6,000. With 5 seconds left you already have **6,050**. Leftover seconds can print $0. Yes still wins. Buy ≤ **$0.96**, hold to **$1**.

**Not this product (do not build):**

- “Spot would need to crash $600 in 15s, so it is basically locked”
- Any crash-% / cushion / “almost”
- Gold, WTI, or any non-CFB-60s series
- Buying No in v1 (No cannot be $0-locked; leftover seconds can print arbitrarily high)
- 2-second polling
- Pyth, Binance, TradingView, or Kalshi candle as the lock sum

| | Cash out | Gold fade | TWAP lock |
|---|---|---|---|
| Assets | Checked (often Gold) | Gold | BTC, ETH |
| When | Fat gap | Tiny gap | Last minute + Yes total lock |
| Exit | Bid / stop / flip; **no** dump | Take / stop / flatten / **dump** | **Hold to $1** |
| Safe? | No | No | Only on a true lock + fill |

---

## 2. Feature flag (Admin)

Firestore `system/config.featureFlags`.

| Key | Type | Default | On means |
|---|---|---|---|
| `twapLock` | boolean | **false** (`=== true` only) | Admin allows the path. Phone shows Risk fields. Cloud may run the last-minute watcher and enter. |

No user-facing poll interval. Last-minute sample rate is **1 second**, hardcoded.

`normalizeFeatureFlags`: `twapLock: raw?.twapLock === true`. Missing → Off. Do not inherit `cashOut` or `goldFade`.

**Admin portal:** checkbox **TWAP lock** next to Gold fade.  
`POST /admin/config` `{ featureFlags: { twapLock } }` via `parseAdminFeatureFlagsPatch` + `mergeFeatureFlags`.

**Phone** (`runtimeStore.twapLockFeatureOn`):

- `GET /me/status` → `systemConfig.featureFlags.twapLock === true`
- Risk **TWAP lock** block only when this is true
- Local default **false**

**Cloud:** if `!featureFlags.twapLock`, no new `twap_lock` buys. Open lots **hold to settlement** (no special exit). Admin Off mid-hold does not dump.

**Ship gate:** Admin stays Off in production until the CFB 1Hz adapter is proven against at least one **already settled** KXBTC15M window (our sum and side match Kalshi’s result).

---

## 3. User settings (Risk → Auto-trade)

Shown only if Admin On. Master Off disables the rest.

| Risk key | UI label | Kind | Default | Range |
|---|---|---|---|---|
| `twap_lock_enabled` | TWAP lock | toggle | **false** | — |
| `twap_lock_assets` | TWAP assets | chips | `['BTC','ETH']` | BTC, ETH only. Empty = no buys |
| `twap_lock_max_ask_usd` | Max ask | chase | **0.96** | 0.90–0.97 |

**Reuse, do not add:** `$` per trade, window cap 1, daily loss, max open, **Skip thin bid** (`cash_out_skip_thin_bid`).

**No UI (hardcoded):**

- 1s CF Benchmarks RTI
- Last 60s before Kalshi `close_time` only
- Yes total lock only (`banked >= strike × 60`)
- Hold to $1; no stop, take, flatten, flip
- Fail **closed** on missing samples, bad clock, unknown book if thin-bid On, feed error

Normalize: `twap_lock_enabled === true` only; assets ⊆ {BTC, ETH}; max ask snap 0.01 in range.

Heartbeat `POST /me/status` already merges `config.risk`.

---

## 4. Feed and clock (locked)

**Source:** CF Benchmarks Real-Time Index for that coin (BTC BRTI / ETH equivalent), **one price per UTC second**.  

Cloud reads prints in this order:

1. Optional licensed CFB key in Secret Manager `predict-cfb-api-key` (or env `CFB_API_KEY`). Format `username:key` or JSON `{ "username", "key" }`. Basic auth to CFB `/api/v1/values`.
2. Else Kalshi Trade API passthrough `GET /trade-api/v2/cfbenchmarks/values?id=BRTI` using the existing user Kalshi key already in Secret Manager. No separate CFB license.

**Not** Pyth (`assets.json` pythFeedId is for lean only).  
**Not** `getKalshiEventLiveSpot` unless a recorded settled window proves that series **is** the RTI 1Hz print. Unproven → do not use.

**Window:** `[close_time − 60s, close_time)`. Print for second `T` is the RTI stamped in that second.  
**Gap:** if any elapsed second in that window has no print → **no buy** that tick (fail closed). Do not carry-forward.

**Strike:** Kalshi official strike on the market (`floor_strike` / contract rule). Not a round number you typed.

**Clock:** Cloud time vs `close_time`. If close is unknown or skew > 1s vs exchange time, **no buy**.

**Watcher:** in-process **1s** loop only while any armed user has TWAP lock On and a BTC/ETH window is inside the last **70s**. Rest of the minute stays the normal ~20s tick. Do not poll 1s all day.

---

## 5. Enter (`evaluateTwapLockEnter`)

All must pass:

1. Admin `twapLock` and `risk.twap_lock_enabled`
2. Asset in `twap_lock_assets` and is BTC or ETH
3. Market live; now inside last 60s before close
4. Official strike finite
5. Complete 1s RTI series for every elapsed second in the last-minute window
6. `banked >= strike × 60` (Yes total lock)
7. At least **1 second** still left to place (if `n === 0`, too late)
8. Yes **ask** ≤ `twap_lock_max_ask_usd` and in the 1¢–99¢ book
9. Shared static gate: Auto armed, size, max open, daily loss, window cap 1  
   Overlay: `smart_buy_enabled: false`, `max_entry_ask_usd` = TWAP max ask, **do not** require cushion (this is not a lean)
10. No open fill on this ticker from **any** path
11. If Skip thin bid On: Yes bid size ≥ `gate.count`; `bidSize == null` → **fail closed** (unlike Cash out). A lock buy that cannot exit is not needed — we hold to $1 — but a ghost size means a bad book; skip
12. Feed / parse / clock error → skip `twap_lock_feed` (fail closed)

`entryPath`: **`twap_lock`**. Side is always **Yes**.

Skip labels:

| reason | Home label |
|---|---|
| `twap_lock_admin_off` / `twap_lock_off` | twap lock off |
| `twap_lock_asset_off` | twap asset off |
| `twap_lock_not_last_minute` | (internal) |
| `twap_lock_not_locked` | not locked |
| `twap_lock_ask_rich` | ask too rich |
| `twap_lock_feed` | lock feed |
| `twap_lock_holding_other_path` | already holding |
| `twap_lock_too_late` | too late |

If TWAP lock is On for a coin (Admin + user + chip): **Cash out and lean Auto do not enter that coin** for the whole 15m window. They would spend the window cap before a lock can appear. Gold fade is Gold-only. Home Buy remains a tap. Open fill or window cap still blocks a second path.

---

## 6. After the fill (locked)

- **Hold to settlement.** No Protect, no Cash out exit, no Gold fade exit, no Home Sell.
- `pendingProtectTradesForMarket` skips `twap_lock` (same as `cash_out` / `gold_fade`).
- Home Buy/Sell: `twap_lock_holding`.
- Alert on place: **TWAP lock**. Settlement uses existing $1 / $0 result alerts.
- IOC miss: no lot, try next 1s tick if still locked and ask still ≤ max.
- Admin Off after fill: still hold (already on Kalshi).

---

## 7. Isolation

- Window cap 1 counts this buy
- Open `twap_lock` blocks Home / Auto / Cash out / Gold fade on that ticker
- Those paths block a new TWAP lock
- Never buy Yes and No together

---

## 8. What we will not add later without a new spec

- No-side lock  
- Crash bound / “virtual lock”  
- Gold  
- SOL/DOGE/XRP/BNB  
- User poll seconds  
- Max ask above $0.97  
- Selling before settlement  

---

## 9. Tests (required before deploy)

- `banked >= strike * 60` → lock; `banked` one cent short → not locked  
- 45 samples at strike+$150 → **not** locked (this is the blog-post trap)  
- Missing one second → no buy  
- Ask $0.98 vs max $0.96 → skip  
- BTC Off / Gold asset → skip  
- Admin Off / user Off → skip  
- Thin bid On + `bidSize` null → skip  
- Protect does not sell `twap_lock`  
- `POST /me/status` persists keys  
- UI hidden until `twapLockFeatureOn`; toggle default Off  
- `normalizeFeatureFlags(null).twapLock === false`  
- Feed proof test: fixture of a settled window matches Kalshi Yes/No  

---

## 10. File map (when building)

| Area | Files |
|---|---|
| Math | `packages/trading-core/src/twapLock.ts` |
| Feed | Cloud adapter + Secret Manager if CFB needs a key |
| Flags | `featureFlags.ts`, admin HTML, `runtimeStore`, `cloudClient` |
| Cloud | `worker` last-minute 1s loop, place `entryPath: 'twap_lock'` |
| UI | `RiskScreen` TwapLockFields, FAQ, help, History chip **TWAP lock** |
| Tests | `__tests__/twap-lock.test.ts`, cloud + settings + FAQ |

---

## 11. Locked numbers

- Sample count **60**, interval **1s**, last minute only  
- Yes lock: **banked ≥ strike × 60**  
- Max ask default **$0.96** (0.90–0.97)  
- Assets default **BTC + ETH**  
- Admin + user default **Off**  
- Hold to **$1**  
- Fail closed on feed/gap/clock  
- Thin bid shared with Cash out; unknown size → no buy  

---

## 12. Honest expectation (product copy)

Most windows: **no trade**. A true $0-remaining lock usually appears only in the **last 1–3 seconds**, and only if the running average is already **well above** the strike. When it is locked, the ask is often **98–99¢** — skip. The win is a **rare 4–5¢** fill at 95–96¢, not daily volume.
