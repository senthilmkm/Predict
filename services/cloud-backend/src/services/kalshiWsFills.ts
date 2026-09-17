import { KalshiClient } from 'trading-core';
import {
  orderFillIsTerminal,
  parseContractCount,
  placeFillLooksComplete,
  preferOrderFields,
  type KalshiOrderFields,
} from '../../../../packages/trading-core/src/orderFill';
import {
  kalshiWsAuthHeaders,
  kalshiWsUrl,
  openDefaultKalshiWs,
  parseKalshiWsPayload,
  type KalshiWsSocket,
} from './kalshiWsQuotes';

let fillsEnabled = false;
let fillDisagree = 0;
let openFillSockets = 0;

const FILL_WS_WAIT_MS = process.env.NODE_ENV === 'test' ? 30 : 4200;

export function setKalshiWsFillsEnabled(on: boolean): void {
  fillsEnabled = on === true;
}

export function kalshiWsFillDisagreeCount(): number {
  return fillDisagree;
}

export function kalshiWsFillOpenSocketsForTests(): number {
  return openFillSockets;
}

export function resetKalshiWsFillsForTests(): void {
  fillsEnabled = false;
  fillDisagree = 0;
  openFillSockets = 0;
}

function fieldsFromFillMsg(msg: Record<string, unknown>, prev: KalshiOrderFields): KalshiOrderFields {
  // `count` on user_orders is order size, not fill size. REST still wins on disagree.
  const fill = msg.fill_count ?? msg.filled_count;
  const remaining = msg.remaining_count ?? msg.remainingCount;
  const status = String(msg.status ?? msg.order_status ?? '').toLowerCase() || prev.status;
  return preferOrderFields(prev, {
    order_id: String(msg.order_id ?? prev.order_id ?? '') || prev.order_id,
    fill_count: fill != null ? String(fill) : prev.fill_count,
    remaining_count: remaining != null ? String(remaining) : prev.remaining_count,
    average_fill_price: msg.average_fill_price != null ? String(msg.average_fill_price) : prev.average_fill_price,
    status: status || prev.status,
  });
}

function isOurOrder(msg: Record<string, unknown>, orderId: string): boolean {
  return String(msg.order_id || '').trim() === orderId;
}

function fillIsUseful(fields: KalshiOrderFields | null): fields is KalshiOrderFields {
  if (!fields) return false;
  return (
    placeFillLooksComplete(fields) ||
    orderFillIsTerminal(fields) ||
    parseContractCount(fields.fill_count) > 0
  );
}

/**
 * Race fill/user_orders vs REST poll. REST always finishes; REST wins if fill counts disagree.
 */
export async function confirmPlaceFillWsOrRest(
  client: KalshiClient,
  initial: KalshiOrderFields,
  openWs: (url: string, headers: Record<string, string>) => KalshiWsSocket = openDefaultKalshiWs
): Promise<KalshiOrderFields> {
  if (!fillsEnabled || !initial.order_id) {
    return client.restConfirmPlaceFill(initial);
  }
  const restP = client.restConfirmPlaceFill(initial);
  const creds = client.credentials;
  const orderId = initial.order_id;
  let socket: KalshiWsSocket | null = null;
  openFillSockets += 1;
  const wsP = new Promise<KalshiOrderFields | null>((resolve) => {
    let settled = false;
    const finish = (value: KalshiOrderFields | null) => {
      if (settled) return;
      settled = true;
      try {
        socket?.removeAllListeners?.();
        socket?.close();
      } catch {
        /* */
      }
      resolve(value);
    };
    try {
      socket = openWs(kalshiWsUrl(creds.env), kalshiWsAuthHeaders(creds.keyId, creds.privateKeyPem));
    } catch {
      finish(null);
      return;
    }
    let acc: KalshiOrderFields | null = null;
    const onMsg = (raw: unknown) => {
      const data = parseKalshiWsPayload(raw);
      if (!data) return;
      const type = String(data?.type || '');
      const msg = (data?.msg && typeof data.msg === 'object' ? data.msg : data) as Record<string, unknown>;
      if (type !== 'fill' && type !== 'user_order' && type !== 'user_orders') return;
      if (!isOurOrder(msg, orderId)) return;
      acc = fieldsFromFillMsg(msg, acc || initial);
      if (fillIsUseful(acc)) finish(acc);
    };
    socket.on('message', onMsg);
    socket.on('open', () => {
      try {
        socket?.send(JSON.stringify({ id: 1, cmd: 'subscribe', params: { channels: ['fill', 'user_orders'] } }));
      } catch {
        finish(null);
      }
    });
    socket.on('error', () => finish(acc));
    socket.on('close', () => finish(acc));
    setTimeout(() => finish(acc), FILL_WS_WAIT_MS);
  }).finally(() => {
    openFillSockets = Math.max(0, openFillSockets - 1);
  });

  const [rest, ws] = await Promise.all([restP, wsP]);
  if (ws) {
    const restFill = parseContractCount(rest.fill_count);
    const wsFill = parseContractCount(ws.fill_count);
    if (restFill !== wsFill) {
      fillDisagree += 1;
      return rest;
    }
    return preferOrderFields(rest, ws);
  }
  return rest;
}

export function attachKalshiWsFillOverride(
  client: KalshiClient,
  openWs?: (url: string, headers: Record<string, string>) => KalshiWsSocket
): KalshiClient {
  client.fillConfirmOverride = (initial) => confirmPlaceFillWsOrRest(client, initial, openWs || openDefaultKalshiWs);
  return client;
}
