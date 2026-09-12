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
