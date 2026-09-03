import { getKeyValueStore } from '../platform/storage';
import { AlertRecord, MemoryAlertRepo, MemoryTradeRepo, TradeRecord } from './repos';

const TRADES_KEY = 'foresight.trades.v1';
const ALERTS_KEY = 'foresight.alerts.v1';

export async function hydrateRepos(
  trades: MemoryTradeRepo,
  alerts: MemoryAlertRepo,
  alertRetentionDays = 30
): Promise<void> {
  const kv = getKeyValueStore();
  try {
    const t = await kv.getItem(TRADES_KEY);
    if (t) {
      const rows = JSON.parse(t) as TradeRecord[];
      trades.clear();
      for (const row of rows.reverse()) trades.insert(row);
    }
  } catch {
    /* ignore */
  }
  try {
    const a = await kv.getItem(ALERTS_KEY);
    if (a) {
      const rows = JSON.parse(a) as AlertRecord[];
      alerts.clear();
      for (const row of rows.reverse()) alerts.insert(row);
    }
  } catch {
    /* ignore */
  }
  alerts.pruneOlderThanDays(alertRetentionDays);
}

export async function persistRepos(
  trades: MemoryTradeRepo,
  alerts: MemoryAlertRepo,
  alertRetentionDays = 30
): Promise<void> {
  alerts.pruneOlderThanDays(alertRetentionDays);
  const kv = getKeyValueStore();
  await kv.setItem(TRADES_KEY, JSON.stringify(trades.list(500)));
  await kv.setItem(ALERTS_KEY, JSON.stringify(alerts.list(500)));
}
