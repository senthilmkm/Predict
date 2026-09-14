# Cheap loop — locked design

Status: **locked for 15m**. Stop **Off**. Hold until **Take or Flatten**. Admin + user default Off. Empty chips = no buys.

Product name: **Cheap loop**  
Firestore / code keys: `cheapLoop` (admin), `cheap_loop_*` (user risk), `entry_path: 'cheap_loop'`

Path tile: **15 min** toggle + knobs, then **Hourly** toggle + own knobs (ATM ladder). Same Admin flag.

**Cheap-side hold for take**: buy the cheaper ticket → wait → sell when that side’s **bid ≥ fill + Take** → cooldown → look again up to **Cycles**. If Take never prints, **Flatten** dumps. **No Stop.** Always dump. Never hold to $1. Never hold YES and NO at once.

Predict lists **15m** series on Home. Hourly Cheap loop is Cloud-only on `KX*D` ATM books.

Goal: **small locked-in takes**, or flatten. Fail closed. Not Pair lock. Not Cash out. Not Spike fade (one lot).

---

## 1. One cycle

1. After **Start after**, if a ticket is cheaper and passes the cheap gate → buy **Lot contracts** IOC.
2. **Min hold** must pass, then if that side’s **bid ≥ fill + Take ¢** → sell bid IOC.
3. **Cooldown** minutes (no buy).
4. Look again. Cheaper may still be YES, or now NO. If cheap gate passes and **Cycles** remain → buy.
5. In the last **Flatten left** minutes: no new buys. If holding, sell bid IOC. No Stop dump before that.

**Cycles** = completed **exits** (take or flatten) on this **market ticker**. Sitting out does not burn a cycle. A buy IOC miss does not burn a cycle. Cycle count resets when the 15m ticker changes.

---

## 2. Feature flag (Admin)

Firestore `system/config.featureFlags.cheapLoop`. Default **false** (`=== true` only).

Phone shows the Paths tile only when this is true. Cloud may 1s-watch and enter only when Admin + user are On **unless** an open Cheap loop lot exists.

Open `cheap_loop` lots still **exit** if Admin, user master, chip, Cushions, or Auto-trade later turn Off (same as Gold fade open lots). After that exit, no next cycle.

---

## 3. Settings → Paths tile

**One new tile**, same pattern as Pair lock / Spike fade.

| | |
|---|---|
| Tile id | `cheapLoop` |
| Title | Cheap loop |
| Sub | Cheap side, take or flatten |
| Admin flag | `cheapLoopFeatureOn` / `featureFlags.cheapLoop` |
| Hidden when | Admin Cheap loop is Off (tile does not show) |
| Tap | Opens **only** the Cheap loop block (toggle + knobs + asset chips) |
| Star | Pin on Home, three max, same as other path tiles |
| Guide | One card on Paths guide |

Not a tab under Cushion lean. Not mixed into Cash out or Spike fade. Shared limits stay their own tile.

---

## 3b. User settings (that tile)

Shown only if Admin flag On. Master user switch default **Off**. Other fields disabled when master Off.

Shipped defaults are **15m trial**. Hourly numbers stay in this table for a later catalog.

| Risk key | UI label | Kind | 15m shipped | Hourly later | Range | Notes |
|---|---|---|---|---|---|---|
| `cheap_loop_enabled` | 15 min | toggle | **false** | — | — | 15m master. Hourly gets its own toggle later |
| `cheap_loop_start_minutes` | Start after | int | **2** | 10 | 1–20 | No buys until this many minutes elapsed |
| `cheap_loop_flatten_minutes` | Flatten left | int | **5** | 5 | 3–10 | No new buys; dump if holding |
| `cheap_loop_cheap_max_ask_usd` | Cheap max ask | chase | **0.40** | 0.40 | 0.25–0.45 | Cheaper ask must be ≤ this |
| `cheap_loop_min_gap_usd` | Min gap | chase | **0.10** | 0.10 | 0.08–0.20 | \|YES ask − NO ask\| |
| `cheap_loop_min_live_cushion_pct` | Min live % | int | **15** | — | 0–50 | 15m only. \|live − strike\| ≥ this % of that coin’s Cushions $. 0 = off. Hourly does not use this |
| `cheap_loop_take_usd` | Take | chase | **0.05** | 0.05 | 0.03–0.08 | Sell when held **bid** ≥ fill + this. Minimum trigger, not a cap |
| `cheap_loop_stop_usd` | *(unused)* | — | unused | — | — | **Stop Off.** Do not show. Do not sell on ask ≤ fill − Stop. Leftover Firestore value is ignored |
| `cheap_loop_min_hold_minutes` | Min hold | int | **1** | 2 | 1–8 | After buy, take cannot fire until this elapses |
| `cheap_loop_cooldown_minutes` | Cooldown | int | **2** | 3 | 1–10 | After an exit, no new buy |
| `cheap_loop_cycles` | Cycles | int | **1** | 2 | 1–5 | Max exits this ticker this window |
| `cheap_loop_lot_count` | Lot contracts | int | **1** | 1 | 1–5 | Size = lots × live ask |
| `cheap_loop_skip_thin_bid` | Skip thin bid | checkbox | **false** | false | — | Own switch; missing = Off; do not inherit Cash out |
| `cheap_loop_assets` | Cheap loop assets | chips | **[]** | [] | catalog | Empty = no buys. Asset must also be On in Cushions |

**Hard-coded, no UI:**

- IOC only
- 5s grace after fill (own print must not Take)
- Sell is **bid IOC** (take / flatten)
- One open Cheap loop lot per ticker
- Never YES and NO at once
- **Stop Off** — leftover `cheap_loop_stop_usd` is ignored
- Do not copy Auto $, Smart buy, chase, Auto TIF, Cash out / Gold fade / Pair lock / Last-minute knobs
- Do not auto-check HYPE / NEAR / ZEC onto chips

Normalize: `cheap_loop_enabled === true`; clamp / snap like other chase + int fields. Missing `cheap_loop_skip_thin_bid` → **false**. Persist via `POST /me/status` risk merge.

**Live knobs while holding:** Take / Min hold / Flatten use the **current** saved config (same as the Home watch line). Stop is unused.

**Profit clamps (do not loosen in code):**

- Stop is **Off**. Do not cut Take against a leftover Stop field.
- Cheap max **≤ $0.45**. 55¢ is a favorite, not a scalp.
- Min gap **≥ 8¢**. No 50/50 churn.

---

## 4. Cheap gate (every buy)

All must pass:

1. Admin `cheapLoop` and `cheap_loop_enabled`
2. Asset On in Cushions **and** selected on Cheap loop chips
3. `lean.phase === 'live'`
4. Minutes elapsed ≥ Start after
5. Minutes left **>** Flatten left
6. Exits this ticker this window **<** Cycles
7. Not in Cooldown
8. This path does not already hold this ticker (`cheap_loop_holding`)
9. No other open fill on this ticker, including Home tap / manual / any path (`cheap_loop_holding_other_path`)
10. Both asks present; neither ≥ $0.995
11. Cheaper ask = min(YES ask, NO ask). Tie → skip `cheap_loop_no_cheap_side`
12. Cheaper ask ≤ Cheap max (`cheap_loop_ask_rich`)
13. \|YES − NO\| ≥ Min gap (`cheap_loop_no_favorite`)
14. \|live − strike\| ≥ Min live % of that coin’s Cushions $ (`cheap_loop_below_min_live`). Missing live gap fail closed. 0% = off. Cushion ≤ 0 with % On fail closed. Hourly maps this to 0
15. Shared static gate: lot size, max open, daily loss, Auto armed. **Window cap 1 does not block this path** — Cycles is the cap. Place lock uses `existingBuys + 1` so a second cycle is not window-capped, but an in-flight order still blocks a double submit.
16. Skip thin bid On: fail closed if bid size unknown or `<` lots
17. TWAP lock On for BTC/ETH → those two stay with TWAP (`cheap_loop_twap_owns`)
18. Last-minute in its buy window with no Cheap loop lot → Last-minute owns new buys (`cheap_loop_last_minute_owns`)

`entry_path`: **`cheap_loop`**.

In-flight: `tryAcquirePlaceLock` before place; re-read trades and re-run the gate; `releasePlaceLock` in `finally`. Same as Spike fade.

---

## 4b. Cloud pick order (locked)

TWAP → Last-minute → Spike fade → Step buy → Pair lock → **Cheap loop** → Gold fade → Cash out → Auto

Cheap loop’s enter gate is common. It must not sit above Spike or Pair lock.

- Spike / Step / Pair keep first pick when their own gate passes.
- Cheap loop only starts if those declined.
- While Cheap loop **holds**, every other path sits out on that ticker.
- While Cheap loop is in **cooldown** with cycles left and Flatten left has not hit: Spike / Step / Pair / Auto / Cash out / Gold fade sit out. Last-minute may still own new buys if Cheap loop has no lot (existing Last-minute rule).
- While inside Start after…Flatten left, Cycles remain, and this path is On for the chip: Auto / Cash out / Gold fade do not enter (even before the first buy).
- Same chip as Pair lock / Spike: those paths win the first ticket. Use different chips if you want Cheap loop to run.

---

## 5. Exit logic (`evaluateCheapLoopExit`)

1s watcher from the fill (and while Cycles remain + cooldown, so the next enter can fire). Same 1s global watch map as Spike fade — do not merge paths.

**Same-tick priority (locked):**

1. Window ended, or minutes left ≤ Flatten, or held ask ≥ $0.995 → **flatten** (even in the 5s grace)
2. Else still in 5s grace → **hold** (blocks Take)
3. Else Min hold elapsed **and** held **bid** ≥ fill + Take → **take**
4. Else hold

**Stop is Off.** A 30¢ ticket that prints 22¢ **holds** until Take or Flatten. Do not dump on ask ≤ fill − 6¢.

**Min hold vs Take:** Take cannot fire before Min hold. If the bid jumped through Take during Min hold, sell after Min hold **if the bid is still ≥ fill + Take**. If it faded, wait for Take or Flatten.

Sell with no bid / thin bid: skip this pulse and retry every 1s. Skip-thin is **buy-only**. Do not invent a dump.

Sell IOC miss → retry every 1s until fill or window end. Do not start Cooldown until the sell fills (or the window ends with a flatten attempt). Partial IOC: same as Spike fade (count the filled contracts; retry leftover via the open-lot watcher).

After a filled exit: `cyclesUsed += 1`, start Cooldown, clear hold.

---

## 6. Cooldown and re-entry

- Cooldown starts at the **exit fill** time (`settledAt`), not the buy time.
- During Cooldown: no buy. Watcher stays on the ticker if Cycles remain and Flatten left has not hit.
- After Cooldown: re-run cheap gate. Same side is allowed (YES 30¢ → take → YES still 32¢ and cheaper).
- If the book is 48/52 or both asks > Cheap max → sit. No cycle burned.
- Flatten left reached during Cooldown → stop. No leftover buy.

Window ends mid-cooldown → stop. Cycle store is the trade book for that market ticker (survives process restart).

---

## 7. Isolation

- Own path. Default Off. Admin must enable the block first.
- Size is Lot contracts × live ask — not Auto $5.
- Home tap / manual / any open fill blocks a new Cheap loop buy. Cheap loop only sells its own `cheap_loop` lots. Protect skips Cheap loop rows.
- Shared: max open, trades/day, daily loss. Each **buy** counts as a live fill.

---

## 8. Edge cases

| Case | Behavior |
|---|---|
| Equal asks | Sit out (`cheap_loop_no_cheap_side`) |
| After take, other side is not cheap | Sit until cheap gate passes or Flatten left |
| After take, same side still cheap | Re-buy same side if gate passes |
| Book 50/50 | Sit (Min gap) |
| $1.00 ask | No buy; if holding, flatten |
| Thin book / timeout | Skip thin On = fail closed on **buy**. Off = place. Sell: retry 1s |
| Buy IOC miss | Retry 1s; no cycle |
| Sell IOC miss | Retry 1s; still holding; no cooldown yet |
| Partial IOC | Count filled; watcher keeps the open remainder |
| Two assets | Independent cycle counts and cooldowns |
| Daily loss / max open | Shared gate; no new buy |
| Admin / user / chip / Cushions / Auto Off with open lot | Continue exits only; no next cycle |
| Manual / Home tap lot | `cheap_loop_holding_other_path` |
| In-flight place | Place lock; re-read + re-gate |
| Take ≥ Stop on Save | Ignored — Stop is Off. Take clamps to 3–8¢ only |
| 15m window | Shipped. Cycles 1, Start after 2, Stop Off, take or flatten |
| Hourly window | Own toggle + clocks after 15m ships. Needs hourly series in catalog + Cloud lean. Do not point 15m knobs at hourly tickers |

---

## 9. Home / skip labels

| reason | Label |
|---|---|
| `cheap_loop_admin_off` / `cheap_loop_off` | cheap loop off |
| `cheap_loop_asset_off` | cheap loop asset off |
| `cheap_loop_outside_window` | cheap loop outside window |
| `cheap_loop_too_late` | too little time left |
| `cheap_loop_cycles` | cheap loop cycles used |
| `cheap_loop_cooldown` | cheap loop cooldown |
| `cheap_loop_ask_rich` | cheap side not cheap |
| `cheap_loop_no_favorite` | no cheap-side gap |
| `cheap_loop_no_cheap_side` | no cheaper side |
| `cheap_loop_no_ask` | no ask |
| `cheap_loop_thin_bid` | bid too thin |
| `cheap_loop_holding` | cheap loop is holding this ticket |
| `cheap_loop_holding_other_path` | another path already holding |
| `cheap_loop_twap_owns` | twap lock owns this coin |
| `cheap_loop_last_minute_owns` | last-minute owns new buys |

Watch line while holding: `Cheap loop holding · take +5¢` (use live Take).  
Watch line in cooldown: `Cheap loop cooldown · 80s`.

---

## 10. Alerts

- Fill: `Cheap loop · {asset} {YES\|NO} · {n} ctr @ $x.xx`
- Take / flatten: same pattern as Spike fade dump (`sold @`)
- IOC miss: existing miss title with `entryPath: 'cheap_loop'`

---

## 11. Tests

- Cheap gate: 30/70 buys YES; 49/51 sits; 52/48 sits (favorite, not cheap); equal sits.
- Min hold blocks take. Ask dump during min hold does **not** sell (Stop Off).
- Flatten / $1 ask during grace still sells.
- Broken book (ask well below fill, bid not at Take) **holds**.
- Take after min hold when bid still ≥ fill + Take.
- Cooldown blocks re-entry; same-side re-entry allowed after cooldown.
- Cycles 1: second exit skipped. Cycles 2: third exit skipped.
- Flatten left: no buy; open lot dumps.
- Window cap 1 on Auto does **not** block Cheap loop lot 2.
- Protect skips `cheap_loop` rows.
- TWAP owns BTC/ETH.
- Home tap blocks enter.
- Normalize clamps Take independently of leftover Stop + missing skip-thin is Off.
- Config persist `/me/status` + Admin flag default Off.

---

## 12. Build order

1. `packages/trading-core/src/cheapLoop.ts` + types + normalize + tests
2. Cloud 1s watcher (copy Spike fade watch map; do not merge paths)
3. Phone Paths block + pathInfo / FAQ / path catalog
4. Admin feature flag
5. Hourly ATM Cheap loop (this ship): own toggle under 15 min, `KX*D` series, `entry_path: cheap_loop_hourly`

Do not auto-check HYPE/NEAR/ZEC onto chips. Do not loosen Cheap max or Min gap. Stop stays Off. Do not point 15m knobs at hourly tickers.

---

## 13. Hourly (ATM ladder) — locked

Status: **shipping**. Same Admin flag `cheapLoop`. Own user toggle **Hourly** under the 15 min block. Default Off. Empty hourly chips = no hourly buys.

Kalshi hourly is **above/below strike ladders** (`KXBTCD`, `KXETHD`, …), not 15m up/down. Cheap loop still buys and sells YES/NO on **one** book: the **unique ATM strike** (closest `floor_strike` to live). Tie → sit `cheap_loop_hourly_no_atm`. After a fill, watch **that ticker**; do not hop ATM mid-lot. After Take/Flatten + Cooldown, pick ATM again.

**Tile:** 15 min toggle + 15m knobs, then Hourly toggle + hourly knobs + hourly chips.

| Risk key | UI |  Hourly shipped | Range |
|---|---|---|---|
| `cheap_loop_hourly_enabled` | Hourly | **false** | — |
| `cheap_loop_hourly_start_minutes` | Start after | **10** | 1–20 |
| `cheap_loop_hourly_flatten_minutes` | Flatten left | **5** | 3–10 |
| `cheap_loop_hourly_cheap_max_ask_usd` | Cheap max ask | **0.40** | 0.25–0.45 |
| `cheap_loop_hourly_min_gap_usd` | Min gap | **0.10** | 0.08–0.20 |
| `cheap_loop_hourly_take_usd` | Take | **0.05** | 0.03–0.08 |
| `cheap_loop_hourly_min_hold_minutes` | Min hold | **2** | 1–8 |
| `cheap_loop_hourly_cooldown_minutes` | Cooldown | **3** | 1–10 |
| `cheap_loop_hourly_cycles` | Cycles | **2** | 1–10 |
| `cheap_loop_hourly_lot_count` | Lot contracts | **1** | 1–5 |
| `cheap_loop_hourly_skip_thin_bid` | Skip thin bid | **false** | — |
| `cheap_loop_hourly_assets` | Hourly assets | **[]** | mapped series only |

Hourly series map (chips only if listed): BTC `KXBTCD`, ETH `KXETHD`, SOL `KXSOLD`, DOGE `KXDOGED`, XRP `KXXRPD`, BNB `KXBNBD`, HYPE `KXHYPED`, NEAR `KXNEARD`, ZEC `KXZECD`. No Gold / stocks / forex / daily ladders. Do not auto-check HYPE / NEAR / ZEC.

`entry_path`: **`cheap_loop_hourly`**. Protect skips these rows. Window cap 1 does not block. Cycles count **per hourly event** (`KXBTCD-26SEP1406`), not per strike. **One open hourly Cheap loop lot per asset** (any strike). Cooldown is per event.

Stop Off. Take or Flatten only. Same 5s grace / bid IOC as 15m. Does **not** use 15m Min live % (ATM is already close to live).

TWAP / Last-minute / Spike / Step / Pair stay on **15m** books. They do not first-pick hourly. 15m Cheap loop and Hourly may both hold (different tickers). Shared: max open, daily loss, trades/day.

No open hourly event → sit. Open lot still exits if Hourly toggle later turns Off.

---

## 14. Weekly (ATM ladder) + History Sell — locked

Status: **shipping**. Same Admin flag `cheapLoop`. Own user toggle **Weekly** under Hourly. Default Off. Empty weekly chips = no weekly buys.

Same `KX*D` series as Hourly. Cloud picks the live event whose open→close is **4–10 days** (~7d). Hourly is fail-closed to **20 min–3 h** so a weekend with only a weekly book cannot buy a week as “hourly.” No daily / monthly / annual this pass.

Loop: buy cheap ATM → wait until **bid ≥ fill + Take** → sell → **Cooldown minutes** → hunt ATM again (ATM may move) → repeat until **Flatten left** minutes of that weekly window. Flatten: no new buys; dump if holding. Stop Off. Never both sides. Never hold to $1. One open weekly lot per asset.

`entry_path`: **`cheap_loop_weekly`**. Protect skips these rows. Cycles = completed **exits this weekly event** (default **10**, range **1–50**). Cooldown / Start / Flatten / Min hold are **minutes** (same ranges as hourly). Take / Cheap max / Min gap same 5¢ / 40¢ / 10¢. Skip thin default Off. Min live % mapped to 0 (ATM). Cloud-only; Home stays 15m.

| Risk key | UI | Weekly shipped | Range |
|---|---|---|---|
| `cheap_loop_weekly_enabled` | Weekly | **false** | — |
| `cheap_loop_weekly_start_minutes` | Start after | **10** | 1–20 |
| `cheap_loop_weekly_flatten_minutes` | Flatten left | **5** | 3–10 |
| `cheap_loop_weekly_cheap_max_ask_usd` | Cheap max ask | **0.40** | 0.25–0.45 |
| `cheap_loop_weekly_min_gap_usd` | Min gap | **0.10** | 0.08–0.20 |
| `cheap_loop_weekly_take_usd` | Take | **0.05** | 0.03–0.08 |
| `cheap_loop_weekly_min_hold_minutes` | Min hold | **2** | 1–8 |
| `cheap_loop_weekly_cooldown_minutes` | Cooldown | **3** | 1–10 |
| `cheap_loop_weekly_cycles` | Cycles | **10** | 1–50 |
| `cheap_loop_weekly_lot_count` | Lot contracts | **1** | 1–5 |
| `cheap_loop_weekly_skip_thin_bid` | Skip thin bid | **false** | — |
| `cheap_loop_weekly_assets` | Weekly assets | **[]** | same series as hourly |

15m / Hourly / Weekly may all hold (different tickers). Shared: max open, daily loss, trades/day. TWAP / Last-minute / Spike / Step / Pair stay on **15m**.

### History Sell

On a **pending** fill tagged **Cheap loop hourly** or **Cheap loop weekly**, History shows **Sell**. Tap = sell **that ticker / trade id now** on Kalshi’s book (bid IOC). Does **not** wait for Take, Flatten, or Friday.

Confirm dialog. Placing… lock so a double tap cannot race itself. IOC miss stays pending and releases the claim. Success is a Cheap loop **exit** (cycle++, cooldown, then hunt). Allowed when Auto Off. Allowed on Kill switch (emergency dump). Does **not** require Last signals Buy/Sell. Does **not** go through 15m `computeLean`. Hide Sell on 15m Cheap loop and all other paths.

Race with the 1s watcher: `claimProtectSell` — first wins. Second tap or watcher tick gets `claim_lost`.


