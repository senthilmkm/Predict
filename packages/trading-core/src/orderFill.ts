/** Kalshi place-order can return fill_count 0 before the match is written. */

export type KalshiOrderFields = {
  order_id: string | null;
  fill_count: string | null;
  remaining_count: string | null;
  average_fill_price: string | null;
  status: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function strOrNull(v: unknown): string | null {
  if (v == null || v === '') return null;
  return String(v);
}

export function extractKalshiOrderFields(data: unknown): KalshiOrderFields {
  const root = asRecord(data);
  const nested = asRecord(root?.order);
  const fromList = Array.isArray(root?.orders) ? asRecord((root!.orders as unknown[])[0]) : null;
  const o = nested || fromList || root || {};
  const fill = o.fill_count ?? o.filled_count ?? o.fillCount ?? root?.fill_count;
  return {
    order_id: strOrNull(o.order_id ?? o.orderId ?? root?.order_id),
    fill_count: strOrNull(fill),
    remaining_count: strOrNull(o.remaining_count ?? o.remainingCount ?? root?.remaining_count),
    average_fill_price: strOrNull(o.average_fill_price ?? root?.average_fill_price),
    status: strOrNull(o.status ?? root?.status)?.toLowerCase() ?? null,
  };
}

export function parseContractCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

export function preferOrderFields(prev: KalshiOrderFields, next: KalshiOrderFields): KalshiOrderFields {
  const prevFill = parseContractCount(prev.fill_count);
  const nextFill = parseContractCount(next.fill_count);
  return {
    order_id: next.order_id || prev.order_id,
    fill_count: nextFill >= prevFill ? next.fill_count : prev.fill_count,
    remaining_count: next.remaining_count ?? prev.remaining_count,
    average_fill_price: next.average_fill_price || prev.average_fill_price,
    status: next.status || prev.status,
  };
}

export function placeFillLooksComplete(fields: KalshiOrderFields): boolean {
  if (!(parseContractCount(fields.fill_count) > 0)) return false;
  const remaining = Number(fields.remaining_count);
  if (Number.isFinite(remaining) && remaining > 0) return false;
  return true;
}

export function orderFillIsTerminal(fields: KalshiOrderFields): boolean {
  const status = fields.status || '';
  if (status === 'executed' || status === 'canceled' || status === 'cancelled') return true;
  const remaining = Number(fields.remaining_count);
  if (Number.isFinite(remaining) && remaining <= 0 && parseContractCount(fields.fill_count) > 0) {
    return true;
  }
  return false;
}

/** Production: ~4s of GET /order after place. Tests: no sleep, still poll. */
export function placeFillConfirmWaitMsList(): number[] {
  const test = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  if (test) return [0, 0, 0];
  return [600, 900, 1200, 1500];
}

export function isGoodTillCanceled(tif: unknown): boolean {
  const s = String(tif || '').toLowerCase().replace(/-/g, '_');
  return s === 'good_till_canceled' || s === 'gtc';
}

export function resolvedPlaceFillCount(opts: {
  dryRun?: boolean;
  fillCount?: string | number | null;
  intendedCount?: string | number | null;
}): { fillCount: number; filled: boolean } {
  if (opts.dryRun) {
    const intended = parseContractCount(opts.intendedCount);
    const reported = parseContractCount(opts.fillCount);
    const n = intended || reported;
    return { fillCount: n, filled: true };
  }
  const n = parseContractCount(opts.fillCount);
  return { fillCount: n, filled: n > 0 };
}

export function sleepMs(ms: number): Promise<void> {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
