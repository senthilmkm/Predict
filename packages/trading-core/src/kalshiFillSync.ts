import { ASSETS_CATALOG } from './types';
import { cheapLoopHourlySeriesTicker } from './cheapLoop';
import { parseContractCount } from './orderFill';

export type KalshiFillRow = {
  fillId: string;
  orderId: string;
  ticker: string;
  side: 'YES' | 'NO';
  action: 'buy' | 'sell';
  count: number;
  yesPriceUsd: number | null;
  createdTime: string;
};

export type FillSyncExistingTrade = {
  tradeId: string;
  orderId?: string | null;
  ticker?: string;
  decision?: string;
  fillCount?: number | null;
  outcome?: string | null;
  status?: string;
  entryPath?: string;
};

export type FillSyncCreate = {
  ticker: string;
  asset: string;
  decision: 'YES' | 'NO';
  count: string;
  price: string;
  notionalUsd: number;
  orderId: string | null;
  payPrice: number | null;
  fillCount: number;
  executedAt: string;
  entryPath: string;
};

export type FillSyncUpgrade = {
  tradeId: string;
  fillCount: number;
  payPrice: number | null;
  orderId: string;
  count: string;
  notionalUsd: number;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function dollars(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n > 1 && n <= 99) return Math.round(n) / 100;
  return Math.round(n * 10000) / 10000;
}

export function parseKalshiFills(data: unknown): KalshiFillRow[] {
  const root = asRecord(data);
  const list = Array.isArray(root?.fills)
    ? root!.fills
    : Array.isArray(root?.market_fills)
      ? root!.market_fills
      : Array.isArray(data)
        ? data
        : [];
  const out: KalshiFillRow[] = [];
  for (const row of list) {
    const o = asRecord(row);
    if (!o) continue;
    const ticker = String(o.ticker || o.market_ticker || '').trim();
    const count = parseContractCount(o.count ?? o.fill_count ?? o.filled_count);
    if (!ticker || !(count > 0)) continue;
    const actionRaw = String(o.action || o.order_action || '').toLowerCase();
    const action: 'buy' | 'sell' = actionRaw === 'sell' ? 'sell' : 'buy';
    const sideRaw = String(o.side || o.position_side || '').toLowerCase();
    const side: 'YES' | 'NO' = sideRaw === 'no' ? 'NO' : 'YES';
    const yesPriceUsd = dollars(o.yes_price_dollars ?? o.yes_price ?? o.price_dollars ?? o.price);
    out.push({
      fillId: String(o.fill_id || o.trade_id || o.id || '').trim(),
      orderId: String(o.order_id || o.orderId || '').trim(),
      ticker,
      side,
      action,
      count,
      yesPriceUsd,
      createdTime: String(o.created_time || o.ts || o.timestamp || '').trim(),
    });
  }
  return out;
}

export function groupBuyFillsByOrder(fills: KalshiFillRow[]): KalshiFillRow[] {
  const map = new Map<string, KalshiFillRow>();
  for (const f of fills) {
    if (f.action !== 'buy') continue;
    const key = f.orderId || f.fillId;
    if (!key) continue;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...f });
      continue;
    }
    map.set(key, {
      ...prev,
      count: prev.count + f.count,
      createdTime: f.createdTime || prev.createdTime,
      yesPriceUsd: f.yesPriceUsd ?? prev.yesPriceUsd,
    });
  }
  return [...map.values()];
}

export function assetKeyFromMarketTicker(ticker: string): string {
  const t = String(ticker || '').toUpperCase();
  if (!t) return 'BTC';
  const catalog = [...ASSETS_CATALOG].sort(
    (a, b) => String(b.seriesTicker || '').length - String(a.seriesTicker || '').length
  );
  for (const a of catalog) {
    const series = String(a.seriesTicker || '').toUpperCase();
    if (series && t.startsWith(series)) return a.key;
  }
  for (const a of catalog) {
    const hourly = cheapLoopHourlySeriesTicker(a.key);
    if (hourly && t.startsWith(hourly.toUpperCase())) return a.key;
  }
  return 'BTC';
}

function tickerLooksHourlyOrWeekly(ticker: string): boolean {
  const t = String(ticker || '').toUpperCase();
  for (const a of ASSETS_CATALOG) {
    const hourly = cheapLoopHourlySeriesTicker(a.key);
    if (hourly && t.startsWith(hourly.toUpperCase())) return true;
  }
  return false;
}

function payForFill(fill: KalshiFillRow): number | null {
  if (fill.yesPriceUsd == null) return null;
  if (fill.side === 'NO') return Math.round((1 - fill.yesPriceUsd) * 10000) / 10000;
  return fill.yesPriceUsd;
}

function inferEntryPath(
  fill: KalshiFillRow,
  existing: FillSyncExistingTrade[],
  buys: KalshiFillRow[]
): string {
  const onTicker = existing.filter((t) => String(t.ticker || '').trim() === fill.ticker);
  const known = onTicker.map((t) => String(t.entryPath || '').trim()).find(Boolean);
  if (known === 'pair_lock' || known === 'pair_lock_hedge') {
    return fill.side === 'NO' ? 'pair_lock_hedge' : 'pair_lock';
  }
  if (known) return known;
  const tickerBuys = buys.filter((f) => f.ticker === fill.ticker);
  const yes = tickerBuys.some((f) => f.side === 'YES');
  const no = tickerBuys.some((f) => f.side === 'NO');
  if (yes && no) return fill.side === 'NO' ? 'pair_lock_hedge' : 'pair_lock';
  if (tickerLooksHourlyOrWeekly(fill.ticker)) return 'cheap_loop_hourly';
  return 'auto';
}

function orderIdOf(trade: FillSyncExistingTrade): string {
  return String(trade.orderId || '').trim();
}

function needsFillUpgrade(trade: FillSyncExistingTrade, fillCount: number): boolean {
  const have = Number(trade.fillCount ?? 0);
  if (have >= fillCount) return false;
  const outcome = String(trade.outcome || '').toLowerCase();
  if (outcome === 'exited' || outcome === 'win' || outcome === 'loss') return false;
  return have <= 0 || outcome === 'miss' || String(trade.status || '') === 'CANCELLED';
}

export function planKalshiFillSync(opts: {
  fills: KalshiFillRow[];
  existing: FillSyncExistingTrade[];
  nowIso: string;
}): { create: FillSyncCreate[]; upgrade: FillSyncUpgrade[] } {
  const buys = groupBuyFillsByOrder(opts.fills);
  const knownOrderIds = new Set(opts.existing.map(orderIdOf).filter(Boolean));
  const create: FillSyncCreate[] = [];
  const upgrade: FillSyncUpgrade[] = [];
  for (const fill of buys) {
    const payPrice = payForFill(fill);
    const notionalUsd =
      payPrice != null ? Math.round(fill.count * payPrice * 100) / 100 : 0;
    if (fill.orderId && knownOrderIds.has(fill.orderId)) {
      const row = opts.existing.find((t) => orderIdOf(t) === fill.orderId);
      if (row && needsFillUpgrade(row, fill.count)) {
        upgrade.push({
          tradeId: row.tradeId,
          fillCount: fill.count,
          payPrice,
          orderId: fill.orderId,
          count: String(fill.count),
          notionalUsd,
        });
      }
      continue;
    }
    create.push({
      ticker: fill.ticker,
      asset: assetKeyFromMarketTicker(fill.ticker),
      decision: fill.side,
      count: String(fill.count),
      price: fill.yesPriceUsd != null ? String(fill.yesPriceUsd) : '',
      notionalUsd,
      orderId: fill.orderId || null,
      payPrice,
      fillCount: fill.count,
      executedAt: fill.createdTime || opts.nowIso,
      entryPath: inferEntryPath(fill, opts.existing, buys),
    });
  }
  return { create, upgrade };
}
