# Kalshi WebSocket quotes + fills

Status: **shipped, flags Off in prod.** Cloud can read live books and IOC fill vs miss from Kalshi’s WebSocket. Admin checkboxes stay Off until a platform Kalshi key is in Secret Manager (`predict-platform-kalshi-key`) and quotes have been checked against REST. **Placing and canceling orders stays REST.** Flag Off behaves exactly as REST today.

Goal: Cloud Run may read **live books** and **your IOC fill vs miss** from Kalshi’s WebSocket `wss://external-api-ws.kalshi.com/trade-api/ws/v2` (demo: `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`). **Placing and canceling orders stays REST.** Admin can turn the socket **Off** and Cloud must behave exactly as today.

Signing path for the handshake: `timestamp + "GET" + "/trade-api/ws/v2"` (same RSA-PSS as REST).

---

## 0. Solid architecture (this is the shape we keep)

Kalshi does **not** write Google Cloud. Predict Cloud **pulls** Kalshi, **owns** trading, and the iPhone **only** reads Predict.

```
                    REST place / cancel (user key)
                         ┌──────────────┐
                         │    Kalshi    │
                         └──────▲───────┘
                                │
     quotes WS (platform key)   │   REST events / strike / close
                         ┌──────┴───────┐
                         │              │
              ┌──────────┴───┐    ┌─────┴──────────┐
              │ Quote worker │    │ Trade worker   │
              │ always-on    │    │ /tick (orders) │
              │ 1× WS book   │───►│ reads the book │
              └──────┬───────┘    └────────┬───────┘
                     │                     │
                     ▼                     ▼
              Firestore              trades / alerts
              system/liveAsks
                     │
                     ▼
              iPhone GET /me/quotes  /  /me/status
              (never Kalshi, never a user Kalshi WS)
```

**Rules that keep this solid**

| Rule | Why |
|---|---|
| One writer of the live book | Quote worker (or REST 1s loop today). Trade `/tick` **reads**; it does not open a second quotes WS. |
| iPhone never talks to Kalshi | Keys stay in Secret Manager. Home chips are Cloud `liveAsks`. |
| Orders stay REST | Kalshi has no “place on WebSocket.” |
| Flag Off = today’s REST 1s GETs | Instant rollback. No EAS. |
| Fail closed | Seq gap / stale / no snapshot → REST or skip, never a guessed ask. |
| Fills are per user, short-lived | Not on the shared quotes socket. |

**Do not** open/close Kalshi `orderbook_delta` inside the 58s `/tick` request as the long-term design. That reconnects ~60 times/hour, drops `seq` every minute, and races if two ticks overlap. A socket belongs on an **always-on** process: Cloud Run **min instances = 1**, CPU always allocated, **or** a tiny second service `predict-kalshi-quotes`. `/tick` stays the order brain.

The quotes writer is the process **1s loop** in `index.ts` (`pumpKalshiWsQuotesFromConfig`). Trade `/tick` only **reads**. Turning quotes On in prod wants Cloud Run **min instances = 1** and CPU always allocated so the socket is not torn down between ticks. First deploy keeps flags **Off** (REST unchanged) and does not change instance scaling.

---

## 1. Impacts (read this first)

### 1.1 What we do today

| Job | Today | Auth |
|---|---|---|
| Which 15m/hourly/weekly ticker is live, strike, close | REST `GET /events`, `GET /markets/{ticker}` | **Public** (no user key) |
| Yes/no ask + bid for Home + 1s path ticks | REST `GET /markets/{ticker}` about **once per second** (`writeLiveAskBookPulse`, `buildOneSecondMarketSnapshot`) | Public |
| Bid **size** (skip-thin / unmatched dump) | REST `GET /markets/{ticker}/orderbook` (`getMarketOrderbook`, 3s cache) | Public |
| Place / cancel | REST `POST /portfolio/events/orders` | **User** key |
| Filled vs miss after place | REST `GET /portfolio/orders/{id}` up to ~4s (`confirmPlaceFill`: 600+900+1200+1500 ms) | User key |
| Live spot | Pyth + CFB REST, not Kalshi book | n/a |
| Phone | Never talks to Kalshi for trading | Cloud only |

Cloud Scheduler hits `POST /worker/tick` **once per minute**. That request runs the 20s user loop **and** a 1s quote/path loop until ~58s, then **the process request ends**. There is no always-on Node daemon today. A quotes WebSocket that is solid must live on an **always-on** worker (see §0), not reconnect every `/tick`. Until that worker exists, quotes stay REST.

### 1.2 What a socket can replace

| Replace | Channel | Why |
|---|---|---|
| 1s `GET /markets/{ticker}` yes/no ask+bid | `orderbook_delta` (best bid/ask derived from reconstructed book). Optional `ticker` as a **cross-check**, never as the only source for skip-thin size | Fewer public GETs, book updates between 1s pulses |
| `GET /markets/{ticker}/orderbook` bid size | Same reconstructed book | Same snapshot the asks came from |
| `GET /order` fill poll | `fill` and/or `user_orders` | Know miss vs fill without waiting ~4s |

### 1.3 What must stay REST (do not put on the socket)

- `POST /portfolio/events/orders` and cancel
- Event/series discovery (`GET /events`) and market metadata (strike, close, status)
- Pyth / CFB live spot
- Balance
- Settlement
- Phone ↔ Cloud

If the socket is down, **stale, or seq-gapped**, those reads fall back to the **current REST path**. Trading must not invent a book.

### 1.4 Hard constraints (accuracy)

1. **Public REST quotes need no API key. The WebSocket handshake does.** We cannot reuse “anonymous GET /markets”. Quotes socket needs a **Predict platform Kalshi API key** in Secret Manager. Missing key + flag On → **do not trade on an empty book**; fall back to REST and mark Admin unhealthy.
2. **Fill channel is per Kalshi account.** A platform key will not see `usr_q9ux0gtmtnhl8w5` fills. Fill socket uses **that user’s** key, opened only around `placeOrder`, closed after terminal fill/cancel or timeout. Never one shared fill socket for all users.
3. **`orderbook_delta` is not a quote.** Snapshot first, then deltas. **`seq` must be contiguous.** Gap or apply before snapshot → drop that ticker, REST resnapshot or `get_snapshot`, fail closed until healthy.
4. **Dollar units.** Snapshot levels are `[price_dollars, contract_count_fp]` strings (`"0.0800"`, `"300.00"`). Deltas: `price_dollars`, `delta_fp`, `side: yes|no`. Parse with the same dollar/cents rules as `parseKalshiOrderbook`. Best ask = lowest price with size > 0; best bid = highest. YES and NO books are **separate**. Size is `floor` of fp count, same as REST skip-thin.
5. **Cloud Run can overlap ticks** (scheduler retry). At most **one** quotes socket per process (`connectMutex`). Second `/tick` uses the existing session or waits; never two delta appliers on one Map.
6. **Do not subscribe to all markets.** Subscribe only tickers we already resolved via REST events (15m + hourly + weekly Cheap loop). Cap (e.g. 40). Window roll: `update_subscription` add/delete. Unsubscribe ended tickers or the Map leaks and seq state lies.
7. **Buffer overflow (Kalshi error 25)** = too much data / slow reader. Treat as disconnect. Smaller ticker set, REST fallback, reconnect with backoff. Never apply a partial burst as truth.
8. **Fail closed for money.** Skip-thin / dump / Pair lock hedge: unknown size or stale book → same as today’s REST failure (`null` size), **not** “assume thick.” Enter gates: missing ask → skip (`*_no_ask`), do not use last minute’s price.
9. **Phone / EAS.** No phone change for quotes (Home already reads Cloud `liveAsks`). Fill speed is Cloud-only. Admin flag does **not** need an App Store build.

### 1.5 Product / ops impacts

- **Rate limits:** fewer public GETs; new WS command/subscribe limits. If flag Off, REST volume unchanged.
- **Latency:** books can move between 1s pulses; path ticks still run at 1s. Socket does not make the worker fire faster than 1s unless we later change that (out of scope).
- **IOC misses:** fresher book may reduce *some* stale-ask misses. It will not create liquidity. Pair lock unmatched dump stays the same math.
- **Fill confirm:** if fill-WS On, Order Placed / IOC miss alerts can fire sooner (tens of ms vs up to 4s). History rows stay the same fields.
- **Secrets:** new Secret Manager entry for platform WS key. Rotate without deploy.
- **Admin:** two flags, default **Off**. Health chip: connected / last seq / tickers / last REST fallback reason.

---

## 2. Admin feature flags (rollback)

Store on `system/config.featureFlags`. Default **Off** (missing → Off). Same pattern as Pair lock / Cheap loop.

| Flag | Meaning when On | Off (today) |
|---|---|---|
| `kalshiWsQuotes` | Cloud quotes + orderbook size from `orderbook_delta` when the session is **healthy** | All `getMarketQuote` / `getMarketOrderbook` as now |
| `kalshiWsFills` | After REST place, wait on `fill`/`user_orders` first; REST `GET /order` only if no terminal event by deadline | `confirmPlaceFill` only |

**Independent.** Quotes On + fills Off is the first live experiment. Fills On without quotes is allowed (place still REST).

**Hot switch:** worker reads flags at the **start of each `/tick`**. Flip Off → that request never opens a socket; in-flight session `close()` in `finally`. No deploy. Phone status sync picks up flags for display only if we surface them; trading does not need EAS.

**Safety latch (same tick):** if quotes socket is not authenticated, snapshot missing, seq gap, stale > `KALSHI_WS_STALE_MS` (e.g. 2500), or error 25 → **that ticker** uses REST for the rest of the tick (or until `get_snapshot` succeeds). Do not mix one REST ask with a WS bid size from an old snapshot.

Admin UI (Feature configs):

- Checkbox **Kalshi WebSocket quotes** (default Off)
- Checkbox **Kalshi WebSocket fills** (default Off)
- Read-only health: `quotes: up|down|fallback`, ticker count, last error, last seq age ms
- Copy: Off = current REST 1s GETs and GET /order poll. On = socket for that job only; orders stay REST.

---

## 3. Target architecture

```
Cloud Scheduler 1/min
  POST /worker/tick  (~58s)
    if kalshiWsQuotes:
      open 1× quotes WS (platform key)
      subscribe orderbook_delta for resolved tickers
      apply snapshot/delta on one mutex per ticker
    runLiveAskBookLoop 1s  ──► readQuote(ticker)  // WS if healthy else REST
    1s path/dump ticks     ──► same readQuote / readBook
    placeOrder REST
      if kalshiWsFills: user fill WS wait, else confirmPlaceFill REST
    finally: close quotes WS, drain fill waiters, clear Maps
```

**Single writer:** `KalshiWsQuotesSession` owns `Map<ticker, BookState>`. Path ticks only **read** a frozen copy (`getSnapshot()` clones best bid/ask/size). Never apply deltas on the event loop while a tick is mid-gate without a generation number.

**`BookState` (per ticker):**

- `seq`, `sid`, `updatedAtMs`
- `yes: Map<priceCents, size>` / `no: Map<priceCents, size>` (integer cents keys to avoid `"0.0800"` float drift)
- `ready: boolean` (false until first snapshot)
- `source: 'ws' | 'rest_fallback'`

Kalshi yes/no maps are **bids**. Best bid = max price with size > 0. Best ask is the complement of the opposite bid (`yes_ask = 1 − no_bid`). Convert cents → dollars with 1¢ tickets.

**Quote read API (only Cloud entry):**

```ts
readAskBid(ticker): OneSecondAskQuote | null
readBestBidSize(ticker, side): number | null
```

- Flag Off → current REST (+ existing caches).
- Flag On + ready + not stale → from `BookState`.
- Else REST, set `source: rest_fallback`, increment Admin counter.

`buildOneSecondMarketSnapshot` / `refreshLiveAskBook` / `cashOutBestBidSize` **must** call this API. No leftover direct `getMarketQuote(skipCache)` on the 1s path when the flag is On and WS is healthy. 15s `runOneTick` enter path uses the same helper so Pair lock 15s and 1s do not disagree.

**Fill API:**

```ts
confirmPlaceFillWsOrRest({ userId, orderId, intendedCount, deadlineMs })
```

Wait for `fill`/`user_orders` matching `order_id`. Terminal: executed with count, or canceled with 0. If deadline (keep **4.2s** same as today) → existing `confirmPlaceFill` REST. Never mark filled from a public `trade` print.

---

## 4. Quotes socket (data quality)

### 4.1 Connect

- URL prod/demo from `KalshiEnv`.
- Headers: platform `keyId` + `signKalshiRequest(pem, ts, 'GET', '/trade-api/ws/v2')`.
- `ws` Node library: enable ping/pong keepalive.
- Connect timeout e.g. 2s; fail → REST for the whole tick, do not hang `/tick`.

### 4.2 Subscribe

After REST `computeWatchLeans` / Cheap loop hourly+weekly tickers:

```
{ id: n, cmd: "subscribe", params: { channels: ["orderbook_delta"], market_tickers: [...] } }
```

`id` monotonic from 1 per session. On 15m roll, `update_subscription` `add_markets` / `delete_markets`. After add, wait for **new snapshot** before `ready`.

Optional: `get_snapshot` on seq gap without full resubscribe.

### 4.3 Apply rules (must unit-test)

1. Ignore deltas until snapshot for that ticker.
2. Snapshot **replaces** the maps; set `seq`, `ready=true`.
3. Delta: if `seq !== lastSeq + 1` → `ready=false`, request snapshot, do not apply.
4. `delta_fp` added to size at `price_dollars`; size ≤ 0 → delete level.
5. Unknown `side` / missing ticker / malformed JSON → drop message, log, do not throw the reader loop.
6. Reader loop is `async` and **never `await` Kalshi REST inside the message handler** (deadlock / overflow). Queue `resnapshotNeeded` for a serial task.

### 4.4 Stale / clock

- `updatedAtMs` from `ts_ms` if present, else local receive time.
- If `now - updatedAtMs > 2500` and no REST fallback yet → treat as stale (fail closed).
- Do not use wall-clock vs Kalshi `ts_ms` skew > e.g. 10s as “future book.”

### 4.5 Cross-check (accuracy, sampled)

Every N seconds or 1/50 ticks: REST `GET /orderbook` for one ticker. Compare best yes ask/bid within **1¢** and size within **tolerance 0** for the **top level** (or allow 1 contract if fp rounding). Mismatch → that ticker REST fallback + Admin alert. Do not silently keep WS.

### 4.6 Memory

- Max tickers; LRU unsubscribe oldest ended.
- On `finally`: `ws.close()`, `books.clear()`, `resnapshotNeeded.clear()`, remove listeners. Tests assert `resetKalshiWsForTests()` leaves zero handles.
- No `setInterval` without clear in `finally`.

### 4.7 Races

- **Subscribe vs first snapshot:** gates wait until `ready` or timeout (e.g. 400ms) then REST.
- **Delete market while applying delta:** generation id per ticker; ignore deltas with old gen.
- **`cashOutBestBidSize` parallel:** read clone, never mutate maps from worker.
- **Flag flip mid-tick:** ignore; next `/tick` honors new flag.

---

## 5. Fill socket

- Open **after** REST place returns `order_id`, **or** open-on-demand per user with refcount if several IOC in one tick (Pair lock runner+hedge).
- Subscribe `fill` + `user_orders` (no market filter = that user only; OK for short wait).
- Match `order_id`. Prefer fill count from the fill message; if conflict with REST later, **max(fill)** (same as `preferOrderFields`).
- Close when terminal or deadline. Do not leave user sockets across `/tick` end.
- Auth failure → REST confirm, do not retry WS in a tight loop (lockout).
- **Race:** fill event before our subscribe — keep REST poll in parallel from t=0 (cheap). First terminal wins; cancel the other. This is required for accuracy. Fill-WS is an **accelerator**, not a sole source, until we prove zero missed fills in demo.

Recommended live policy: **`kalshiWsFills` On still runs REST poll in parallel**; WS may finish first. If they disagree, REST wins and Admin counter `fill_disagree`. After a quiet week of zero disagrees, we can stop parallel poll in a later change.

---

## 6. Files to touch (when implementing)

| Area | Files |
|---|---|
| Flags | `featureFlags.ts`, Admin `index.html`, `featureBroadcast.test.ts` |
| Sign WS path | `packages/trading-core/src/sign.ts` (already generic) |
| Session + book apply | **new** `services/cloud-backend/src/services/kalshiWsQuotes.ts` + `kalshiWsBook.ts` (pure apply, no I/O) |
| Fill wait | **new** `kalshiWsFills.ts`; hook `KalshiClient.placeOrder` / worker after place |
| Quote readers | `worker.ts` `buildOneSecondMarketSnapshot`, `cashOutBestBidSize`, `liveAskRefresh.ts` |
| Secrets | `secretManager.ts` platform Kalshi key |
| Tests | book apply, seq gap, stale, flag Off = no `WebSocket` construct, worker still places REST |

Phone: **none** for the migration.

---

## 7. Test plan (must pass before flag On in prod)

### 7.1 Pure book (no network)

- Snapshot then delta: best ask/bid/size match fixture.
- Seq skip → `ready=false`, next snapshot recovers.
- Delta before snapshot ignored.
- Size to 0 removes level; empty side → no ask (enter skip).
- `"0.0800"` / cents dual format; YES vs NO isolation.
- Concurrent clone vs apply: reader never sees torn maps (generation).

### 7.2 Session

- Flag Off: `WebSocket` constructor not called (mock).
- Flag On, no platform key: REST used, health `down`.
- Subscribe list = resolved tickers only; delete on window roll.
- `finally` close; second tick does not stack listeners (leak test: mock `on` count).
- Overlapping `/tick`: one session.

### 7.3 Worker integration (Jest)

- `buildOneSecondMarketSnapshot` with injected book: Pair lock / Cheap loop / Cash out dump see WS asks.
- Skip-thin uses WS size; WS `null` → skip/dump fail-closed like REST.
- `kalshiWsQuotes` Off: still `getMarketQuote`.
- Place order still `POST /portfolio/events/orders`.
- Fills: mock fill event → `filled: true` before REST; mock silence → REST poll result; disagree → REST wins.

### 7.4 Demo E2E (manual, flag On demo only)

1. Admin On quotes, Off fills. Watch Admin health up. Home Live ask moves without extra REST (log REST quote count should drop).
2. REST vs WS top-of-book within 1¢ on BTC/Gold for 10 minutes (script).
3. Cheap loop / Pair lock **do not** place in demo until quotes match REST.
4. Admin Off: REST volume returns; no open sockets (process metrics).
5. Fills On in demo: one manual/Home IOC; alert time vs REST-only baseline; History fill_count matches Kalshi UI.

### 7.5 Prod rollout

1. Flags Off (ship code).
2. Quotes On, fills Off, **one** asset chip if we add a ticker allowlist later; else all watch tickers.
3. Watch `fill_disagree` (should be 0), seq gaps, fallback rate.
4. Fills On only after quotes stable.
5. Any incident: **both flags Off** — instant rollback.

---

## 8. Performance

- One quotes connection per `/tick`, not per user.
- Do not JSON-log every delta.
- Apply deltas O(1) per level; clone only best bid/ask for readers (not full book) unless skip-thin needs top size only.
- Unsubscribe ended 15m tickers immediately.
- Reader must keep up (no sync Secret Manager in handler) to avoid error 25.

---

## 9. Non-goals

- Phone WebSocket to Kalshi
- Replacing Cloud Scheduler 1s loop with event-driven place-on-every-delta (that would change path math / rate limits)
- GTC resting orders
- Using `trade` channel as a fill substitute
- Always-on GCE/Cloud Run min-instance daemon (can be a later hosting change; this design fits **current** 58s `/tick`)

---

## 10. Open items before code

1. Create/store **platform Kalshi API key** in Secret Manager (quotes handshake).
2. Confirm demo vs prod WS hosts in our env mapping.
3. Accept **parallel REST fill poll** while `kalshiWsFills` is On (accuracy over purity).
4. Confirm Admin wants **two** checkboxes (recommended) vs one combined flag.

When those are yes, implement **quotes first** (flag Off in prod until E2E §7.4).
