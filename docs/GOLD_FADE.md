# Gold fade — design (ready to build)

Status: **implemented**. Admin + user default Off. Do not turn the live Admin flag On until you ask.  
Copy Cash out’s two-key pattern: **Admin flag Off** + **user toggle Off**. Both must be On to place.

Product name: **Gold fade**  
Firestore / code keys: `goldFade` (admin), `gold_fade_*` (user risk), `entry_path: 'gold_fade'`

---

## 1. What it is

Gold 15m only. When live gold is **close to the strike**, Cloud buys the **cheaper** ticket, then **exits for a few cents** or **dumps the whole lot** if the fade is over.

It is the opposite of Cash out:

| | Cash out | Gold fade |
|---|---|---|
| Gap | Large (% of cushion) | Small (max gap, default $3) |
| Side | Lean / favorite | Cheaper ask |
| Win | Bid target or $1 | ~6¢ over pay, then flat |
| Window end | **No dump** (settle) | **Sell all** (flatten) |

Not a two-person richer+cheaper pair. Not BTC/ETH. Not hold-for-$1.

---

## 2. Feature flag (Admin) — required

Same store as Cash out: Firestore `system/config.featureFlags`.

| Key | Type | Default | On means |
|---|---|---|---|
| `goldFade` | boolean | **false** (`=== true` only) | Admin allows the path. Phone may show Risk fields. Cloud may evaluate enter/exit. |
| `goldFadeBidCheckSeconds` | number | **3** (clamp 2–10) | Sub-tick watch while a Gold fade lot is open. Reuse Cash out watch machinery. |

`normalizeFeatureFlags`:

- `goldFade: raw?.goldFade === true`
- Missing / null / `"false"` → Off
- Do not inherit `cashOut`

**Admin portal** (`services/cloud-backend/public/admin/index.html`): checkbox **Gold fade** next to Cash out. Save via existing `POST /admin/config` `{ featureFlags: { goldFade } }`.  
`parseAdminFeatureFlagsPatch` must accept `goldFade` and `goldFadeBidCheckSeconds` without wiping other flags (`mergeFeatureFlags`).

**Phone** (`runtimeStore.goldFadeFeatureOn`):

- Set from `GET /me/status` → `systemConfig.featureFlags.goldFade === true`
- Risk **Gold fade** block renders only when this is true (same as `cashOutFeatureOn` + `CashOutFields`)
- Default local state **false** so an old EAS build never shows the block

**Cloud worker**: if `!featureFlags.goldFade`, never enter, never run fade exits. Open `gold_fade` lots left from a later disable: still **exit** them (stop / flatten / profit) so Admin Off does not trap inventory. (Cash out today skips new enters when admin Off; match that for **enters**. For **open fade lots**, prefer continue-exits so flatten still runs. Call this out in implementation: `runCloudGoldFadeExits` even when admin Off if `pendingGoldFadeTrades` exist.)

---

## 3. User settings (Risk → Auto-trade)

Shown only if Admin flag On. Master user switch default **Off**. Other fields disabled when master Off.

| Risk key | UI label | Kind | Default | Range | Notes |
|---|---|---|---|---|---|
| `gold_fade_enabled` | Gold fade | toggle | **false** | — | User master |
| `gold_fade_max_gap_usd` | Max gap | money | **3** | 1–6 | Enter only if `abs_gap` ≤ this |
| `gold_fade_max_ask_usd` | Max cheap ask | chase | **0.50** | 0.35–0.55 | Cheap-side ask must be ≤ this |
| `gold_fade_take_usd` | Take profit | chase | **0.06** | 0.05–0.10 | Sell when held bid ≥ pay + this |
| `gold_fade_stop_usd` | Gold fade stop | chase | **0.05** | 0.03–0.10 | Sell when held bid ≤ pay − this |
| `gold_fade_flatten_minutes` | Flatten with min left | int | **3** | 2–5 | Sell all if minutes left ≤ this and not at take |

**Hard-coded, no UI:**

- Asset = **Gold** only
- Spread cap = Cash out’s `$0.06`
- Grace after fill = Protect / Cash out **45s** (no extra stepper)
- Size / window cap / daily loss = shared Auto risk
- **Skip thin bid** = reuse `cash_out_skip_thin_bid` (one switch). If that switch is Off, fade does not fetch the book.

`CASH_OUT_RISK_FIELD_KEYS` stays Cash out only. New `GOLD_FADE_RISK_FIELD_KEYS` + `GoldFadeFields` on the Auto tab under Cash out.

Normalize (`src/config/normalize.ts` + trading-core defaults):

- `gold_fade_enabled: r.gold_fade_enabled === true`
- Clamp / snap the numbers like other chase fields
- Persist via existing `POST /me/status` risk merge (no API whitelist — do not strip unknown keys)

Heartbeat already sends full `config`. After EAS, first open writes the new keys (`enabled: false`).

---

## 4. Enter logic (`evaluateGoldFadeEnter`)

New module `packages/trading-core/src/goldFade.ts` (do not cram into `cashOut.ts`). Worker imports both.

**Enter only if all pass:**

1. `featureFlags.goldFade` and `risk.gold_fade_enabled`
2. `lean.asset === 'Gold'`
3. `lean.phase === 'live'`
4. `abs_gap ≤ gold_fade_max_gap_usd` (default $3)
5. Cheap side = YES if `yes_ask < no_ask`, else NO (ties: skip `gold_fade_no_cheap_side`)
6. Cheap **ask** ≤ `gold_fade_max_ask_usd` and in 1¢–99¢ book
7. Cheap spread ≤ `$0.06` (else `gold_fade_spread_wide`)
8. Minutes left **>** `gold_fade_flatten_minutes` (must have room to exit; floor 3 like Cash out enter if needed)
9. Minutes elapsed uses shared Auto `min_minutes_elapsed` (or 2)
10. No open fill on this ticker from **any** path (`home` / `auto` / `cash_out` / `gold_fade`)
11. Shared static gate: $ size, max open, daily loss, window cap 1, auto armed
12. Smart buy **Off** for this path (same as Cash out gate overlay)
13. If `cash_out_skip_thin_bid`: fetch book; if `bidSize < gate.count` → skip `gold_fade_thin_bid` (“bid too thin”)
14. Fetch fail / `bidSize == null` → **fail-open** (do not skip)

If Cash out would also enter the same tick (fat gap): fade’s max-gap test **fails** (`abs_gap` is large). No extra arbiter needed. If both toggles On and gap is $2, only fade can enter. If gap is $8, only Cash out / Auto.

`entryPath` on the fill: **`gold_fade`**.

Skip reasons (Home labels):

| reason | Label |
|---|---|
| `gold_fade_admin_off` | gold fade off |
| `gold_fade_off` | gold fade off |
| `gold_fade_not_gold` | (internal; should not show — asset filter) |
| `gold_fade_gap_wide` | gap too wide to fade |
| `gold_fade_ask_rich` | cheap side not cheap |
| `gold_fade_spread_wide` | spread too wide |
| `gold_fade_no_cheap_side` | no cheaper side |
| `gold_fade_thin_bid` | bid too thin |
| `gold_fade_holding_other_path` | Home, Auto, or Cash out already holding |
| `gold_fade_too_late` | too little time left |

---

## 5. Exit logic (`evaluateGoldFadeExit`) — sell **all** contracts

After **45s grace**, first match wins. **Sell the full fill count** (one IOC), same claim lock as Cash out.

| Order | Kind | When | Alert title |
|---|---|---|---|
| 1 | `gold_fade_take` | Held bid ≥ pay + take (default +6¢) | Gold fade |
| 2 | `gold_fade_stop` | Held bid ≤ pay − stop (default −5¢) | Gold fade stop |
| 3 | `gold_fade_thin_bid` | Thin-bid On and best bid size &lt; hold count | Gold fade thin bid |
| 4 | `gold_fade_time` | `minutes_left ≤ flatten` **or** `phase === 'ended'` | Gold fade time |
| 5 | `gold_fade_flip` | Gap ≥ Gold cushion **against** the held cheap side | Gold fade flip |

**Window end: dump.** Unlike Cash out `settle` / no-sell, fade **must sell** when the window is ended or flatten minutes hit. Worst case is a few cents, not $0.

**Flip example:** bought cheap YES at gap $2 under. Live then $8+ under (cushion ~$7). Cheap-side thesis is dead → sell all.

Thin / book unknown: fail-open (no force sell). Empty book → size 0 → thin if On.

IOC miss: revert claim, keep pending (same as Cash out). Do not mark settled on a miss.

Protect money **must skip** `entry_path === 'gold_fade'` (add beside the existing `cash_out` skip).

Home Buy / Sell: block if ticker has open `gold_fade` (same `cash_out_holding` pattern).

---

## 6. Cloud wiring

**Enter** (`routes/worker.ts` full tick, Gold asset only):

```
goldFadeEnter = isGoldFadeEnterPath({ admin, user, asset: Gold })
  && !tickerHasOpenAnything(trades, ticker)
```

If `goldFadeEnter` → `evaluateGoldFadeEnter` → place ask IOC → record `entryPath: 'gold_fade'`.  
Else existing Cash out / Auto chain unchanged.

**Exit** on full tick **and** bid-watch sub-ticks (copy `cashOutWatchUsers` → `goldFadeWatchUsers`). Watch interval = `goldFadeBidCheckSeconds` (default 3). Fetch orderbook only if Skip thin bid On.

`cloudGoldFade.ts`: clone `cloudCashOut.ts` shape (`pendingGoldFadeTradesForMarket`, `runCloudGoldFadeExits`, claim/revert, PnL, alerts).

---

## 7. Phone / History / FAQ

- History chip: **Gold fade** (`entryPathChipLabel`, `adminMetrics.tradeStreamEntryLabel`)
- Home Last signals: skip labels above; do not show Buy on a fade hold (treat like Cash out holding)
- Settings help + FAQ: what fade is, +6¢ / −5¢ / flatten, **not** Cash out, Gold only, default Off
- `cloudClient` `SystemConfig.featureFlags.goldFade?: boolean`

---

## 8. Isolation (do not mix)

- Window cap 1 still counts fade buys
- Open `gold_fade` blocks Cash out, Auto, and Home on that ticker
- Open Cash out / Auto / Home blocks fade
- Paths never “hedge” YES+NO on one account

---

## 9. Tests (must exist before deploy)

- `normalizeFeatureFlags(null).goldFade === false`
- Admin POST merge: `goldFade: true` does not drop `cashOut`
- Normalize: user defaults Off; `gold_fade_enabled: true` sticks
- Enter: gap $2 cheap YES $0.46 → ok; gap $8 → skip; BTC → skip; admin Off → skip; user Off → skip
- Enter: ask $0.56 → skip; spread 8¢ → skip; thin 1 vs count 7 → skip; `bidSize` null → no skip
- Exit: +6¢ take; −5¢ stop; flatten at 3 min; `ended` sells (Cash out contrast test); profit beats stop; grace holds
- Cloud: alert titles; Protect does not sell `gold_fade`; `POST /me/status` persists keys
- UI: block hidden until `goldFadeFeatureOn`; toggle default Off; fields disable when master Off
- FAQ / engine skip strings

---

## 10. Ship order

1. Code + tests (no live flag)
2. Cloud deploy — Admin checkbox exists, **unchecked**
3. EAS — Risk block hidden until Admin On
4. Admin On for the test user only (or all, if you want the block visible)
5. User: Settings → Risk → Auto-trade → **Gold fade** On  
6. Confirm Firestore `users/{id}.config.risk.gold_fade_enabled === true` and worker uses it

Phone never talks to Kalshi. Live money stays Cloud.

---

## 11. File map (implementation checklist)

| Area | Files |
|---|---|
| Math | `packages/trading-core/src/goldFade.ts`, export from `index.ts` |
| Types / defaults | `src/config/types.ts`, `riskDefaults.ts`, `normalize.ts`, `packages/trading-core/src/types.ts` |
| Flags | `featureFlags.ts`, `admin.ts`, `admin/index.html`, `cloudClient.ts`, `runtimeStore.ts` |
| Cloud | `cloudGoldFade.ts`, `worker.ts`, `cloudProtectSell.ts`, `manualTrade.ts`, `cloudAlerts.ts`, `adminMetrics.ts` |
| UI | `RiskScreen.tsx`, `SettingsScreen.tsx` help, `faq.ts`, `tradeDisplay.ts`, `repos.ts` |
| Tests | `__tests__/gold-fade.test.ts`, normalize, faq, engine, `ui/settings.test.tsx`, `cloud-backend` goldFade + featureBroadcast |

---

## 12. Locked numbers (change only if product says so)

- Max gap **$3**
- Max cheap ask **$0.50**
- Take **6¢** over pay
- Stop **5¢** under pay
- Flatten **3 min** left
- Spread **6¢**
- Grace **45s**
- Gold only
- Admin + user default **Off**
- Thin bid shared with Cash out switch
- Dump at window end
