import * as XLSX from 'xlsx';
import { AlertRecord, TradeRecord } from '../storage/repos';

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Build workbook bytes for auto-trading history (trades + alerts). */
export function buildHistoryWorkbook(
  trades: TradeRecord[],
  alerts: AlertRecord[]
): Uint8Array {
  const wb = XLSX.utils.book_new();

  const tradeRows = trades.map((t) => ({
    at: t.at,
    asset: t.asset,
    market_ticker: t.market_ticker,
    side: t.side,
    notional_usd: t.notional_usd,
    fill_price: t.fill_price ?? '',
    pnl_usd: t.pnl_usd ?? '',
    outcome: t.outcome,
    order_id: t.order_id ?? '',
  }));
  const tradeSheet = XLSX.utils.json_to_sheet(
    tradeRows.length
      ? tradeRows
      : [
          {
            at: '',
            asset: '',
            market_ticker: '',
            side: '',
            notional_usd: '',
            fill_price: '',
            pnl_usd: '',
            outcome: '',
            order_id: '',
          },
        ]
  );
  XLSX.utils.book_append_sheet(wb, tradeSheet, 'Trades');

  const alertRows = alerts.map((a) => ({
    at: a.at,
    kind: a.kind,
    title: a.title,
    body: a.body,
    read: a.read ? 'yes' : 'no',
  }));
  const alertSheet = XLSX.utils.json_to_sheet(
    alertRows.length
      ? alertRows
      : [{ at: '', kind: '', title: '', body: '', read: '' }]
  );
  XLSX.utils.book_append_sheet(wb, alertSheet, 'Alerts');

  const summary = [
    { metric: 'trades', value: trades.length },
    { metric: 'alerts', value: alerts.length },
    { metric: 'exported_at', value: new Date().toISOString() },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array;
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

/**
 * Write Excel to cache and open iOS/Android native share sheet.
 */
export async function exportAndShareHistory(
  trades: TradeRecord[],
  alerts: AlertRecord[]
): Promise<{ ok: boolean; uri?: string; error?: string }> {
  try {
    const bytes = buildHistoryWorkbook(trades, alerts);
    const name = `predict-history-${stamp()}.xlsx`;

    const { File, Paths } = await import('expo-file-system');
    const Sharing = await import('expo-sharing');

    const file = new File(Paths.cache, name);
    try {
      if (file.exists) file.delete();
    } catch {
      /* */
    }
    file.create();
    file.write(bytes);

    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      return { ok: false, uri: file.uri, error: 'Share sheet not available on this device' };
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      UTI: 'org.openxmlformats.spreadsheetml.sheet',
      dialogTitle: 'Export auto-trading history',
    });
    return { ok: true, uri: file.uri };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}
