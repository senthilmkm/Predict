import { parseKalshiFills, planKalshiFillSync } from '../../../../packages/trading-core/src/kalshiFillSync';
import { saveTradeRecord, updateTradeRecord, TradeRecordDoc } from './firestore';

type FillsClient = {
  getFills: (opts?: { limit?: number }) => Promise<{ ok: boolean; fills: unknown }>;
};

export async function syncKalshiFillsIntoTradeBook(opts: {
  userId: string;
  client: FillsClient;
  trades: TradeRecordDoc[];
  now: Date;
}): Promise<TradeRecordDoc[]> {
  let data: unknown;
  try {
    const got = await opts.client.getFills({ limit: 100 });
    if (!got.ok) return opts.trades;
    data = got.fills;
  } catch {
    return opts.trades;
  }
  const plan = planKalshiFillSync({
    fills: parseKalshiFills(data),
    existing: opts.trades,
    nowIso: opts.now.toISOString(),
  });
  const next = [...opts.trades];
  for (const row of plan.upgrade) {
    await updateTradeRecord(opts.userId, row.tradeId, {
      status: 'FILLED',
      outcome: 'pending',
      fillCount: row.fillCount,
      count: row.count,
      payPrice: row.payPrice,
      orderId: row.orderId,
      notionalUsd: row.notionalUsd,
    });
    const i = next.findIndex((t) => t.tradeId === row.tradeId);
    if (i >= 0) {
      next[i] = {
        ...next[i],
        status: 'FILLED',
        outcome: 'pending',
        fillCount: row.fillCount,
        count: row.count,
        payPrice: row.payPrice,
        orderId: row.orderId,
        notionalUsd: row.notionalUsd,
      };
    }
  }
  for (const row of plan.create) {
    const tradeId = `trade_sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const doc: TradeRecordDoc = {
      tradeId,
      userId: opts.userId,
      ticker: row.ticker,
      asset: row.asset,
      decision: row.decision,
      count: row.count,
      price: row.price,
      notionalUsd: row.notionalUsd,
      dryRun: false,
      status: 'FILLED',
      executedAt: row.executedAt || opts.now.toISOString(),
      orderId: row.orderId,
      payPrice: row.payPrice,
      fillCount: row.fillCount,
      outcome: 'pending',
      pnlUsd: null,
      entryPath: row.entryPath as TradeRecordDoc['entryPath'],
    };
    await saveTradeRecord(opts.userId, doc);
    next.unshift(doc);
  }
  return next;
}
