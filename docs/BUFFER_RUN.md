# Buffer run — locked design

Status: **locked** (POC 14d). Admin + user default **Off**. BTC / ETH only. Empty chips = no buys.

Product name: **Buffer run**  
Firestore / code keys: `bufferRun` (admin), `buffer_run_*` (user risk), `entry_path: 'buffer_run'`

Goal: **mid-window lean scalp** when spot has a clear buffer vs strike and the lead ask is still mid-priced. Take / stop / lean-flip / flatten. Never hold to $1. One trade per 15m window.

POC model: `poc/buffer-run/MODEL.md`

---

## 1. Locked defaults

| Knob | Default | Notes |
|---|---|---|
| Enabled | Off | Admin flag + user switch |
| Assets | BTC, ETH | Empty = no buys |
| Ask min / max | 42¢ / 62¢ | Lead-side ask must sit in band |
| Take | +12¢ | Bid ≥ fill + Take |
| Stop | −7¢ | Bid ≤ fill − Stop |
| Enter after | 3 min | Minutes elapsed |
| Enter left | 5 min | Must stay above Flatten |
| Flatten left | 3 min | Dump; no new entries |
| ATR × | 1.25 | Lead ≥ max(min gap, ATR×) |
| BTC / ETH min gap | $40 / $2.50 | Floors when ATR thin |
| $ per trade | $2.50 | Path size, not Auto $ |
| Pair-sum skip | 0.98 | Sit when YES+NO ≤ skip |
| Skip thin bid | Off | Fail closed on buy when On |
| Lot count | 1 | Hard max 1 |

---

## 2. Feature flag (Admin)

Firestore `system/config.featureFlags.bufferRun`. Default **false** (`=== true` only).

Phone shows the Paths tile only when this is true. Cloud may enter only when Admin + user are On (open lots still exit).

---

## 3. Enter

1. Admin On, user On, chip On, asset On in Cushions.
2. After **Enter after**, with **Enter left** remaining, and not yet in Flatten.
3. Lead side from spot vs strike. Ask in Ask min…Ask max.
4. Lead ≥ max(asset min gap, 1m ATR × ATR×). Missing ATR uses the floor only.
5. Skip if YES+NO ≤ Pair-sum skip (looks like a lock book).
6. One attempt per ticker per window (including a 0-fill IOC).

---

## 4. Exit

After 5s grace (own print):

1. **Lean flip** — spot crosses strike against the held side → dump.
2. **Take** — bid ≥ fill + Take → dump.
3. **Stop** — bid ≤ fill − Stop → dump.
4. **Flatten** — minutes left ≤ Flatten, or window ended → dump.

Never hold to settlement by design.

---

## 5. Ownership / isolation

When TWAP, Last-minute, Spike fade, Step buy, Pair lock, Cap lock, or Cheap loop owns the coin / ticker, Buffer run sits out.

While Buffer run holds (or has attempted this window), those paths sit that ticker out for a new Buffer run buy.

Protect skips `buffer_run` rows. History Sell on a pending fill dumps bid IOC.

---

## 6. Edge cases

- Ask band: hydrate keeps Ask min &lt; Ask max (else bump max, else reset defaults).
- Take / Stop: hydrate keeps Take &gt; Stop (cuts Take; never raises Stop).
- Timing: Enter left stays above Flatten.
- Thin lead under floor / ATR → `buffer_run_thin_lead`.
- Pair-sum ≤ skip → `buffer_run_pair_lock`.
- TWAP On for BTC/ETH → those coins stay with TWAP.
- Window already attempted → no second buy.
