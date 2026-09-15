import { EventEmitter } from 'events';
import { type KalshiEnv } from 'trading-core';
import { signKalshiRequest } from '../../../../packages/trading-core/src/sign';
import {
  applyOrderbookDelta,
  applyOrderbookSnapshot,
  capTickers,
  emptyTickerBook,
  markBookUnready,
  readAskBidFromBook,
  readBestBidSizeFromBook,
  type TickerBook,
  type WsAskQuote,
} from './kalshiWsBook';

export const KALSHI_WS_PATH = '/trade-api/ws/v2';

export type KalshiWsQuotesHealth = {
  status: 'up' | 'down' | 'fallback';
  tickers: number;
  lastError: string | null;
  lastSeqAgeMs: number | null;
  fallbackReason: string | null;
};

export type KalshiWsSocket = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  on: (event: string, cb: (...args: any[]) => void) => void;
  off?: (event: string, cb: (...args: any[]) => void) => void;
  removeAllListeners?: () => void;
};

export type OpenKalshiWs = (url: string, headers: Record<string, string>) => KalshiWsSocket;

const OPEN = 1;

/** `ws` delivers Buffer; tests inject parsed objects or JSON strings. */
export function parseKalshiWsPayload(raw: unknown): any | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Buffer.isBuffer(raw) && !ArrayBuffer.isView(raw) && !Array.isArray(raw)) {
    return raw;
  }
  try {
    let text = '';
    if (typeof raw === 'string') text = raw;
    else if (Buffer.isBuffer(raw)) text = raw.toString('utf8');
    else if (raw instanceof ArrayBuffer) text = Buffer.from(raw).toString('utf8');
    else if (ArrayBuffer.isView(raw)) {
      const view = raw as ArrayBufferView;
      text = Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('utf8');
    } else if (Array.isArray(raw) && raw.every((part) => Buffer.isBuffer(part))) {
      text = Buffer.concat(raw).toString('utf8');
    } else text = String(raw);
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function defaultOpen(url: string, headers: Record<string, string>): KalshiWsSocket {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WS = require('ws');
  return new WS(url, { headers }) as KalshiWsSocket;
}

let openKalshiWs: OpenKalshiWs = defaultOpen;

export function openDefaultKalshiWs(url: string, headers: Record<string, string>): KalshiWsSocket {
  return openKalshiWs(url, headers);
}

export function setKalshiWsOpenForTests(fn: OpenKalshiWs | null): void {
  openKalshiWs = fn || defaultOpen;
}

export function kalshiWsUrl(env: KalshiEnv = 'production'): string {
  if (env === 'demo') return 'wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2';
  return 'wss://external-api-ws.kalshi.com/trade-api/ws/v2';
}

export function kalshiWsAuthHeaders(keyId: string, privateKeyPem: string): Record<string, string> {
  const timestamp = String(Date.now());
  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'KALSHI-ACCESS-SIGNATURE': signKalshiRequest(privateKeyPem, timestamp, 'GET', KALSHI_WS_PATH),
  };
}

type QuotesSession = {
  socket: KalshiWsSocket;
  sid: number | null;
  cmdId: number;
  tickers: Set<string>;
  books: Map<string, TickerBook>;
  lastError: string | null;
  fallbackReason: string | null;
  resnapshot: Set<string>;
  listeners: Array<{ event: string; cb: (...args: any[]) => void }>;
};

let session: QuotesSession | null = null;
let connectMutex: Promise<void> | null = null;
let wsConstructCount = 0;

export function kalshiWsConstructCountForTests(): number {
  return wsConstructCount;
}

function detach(sock: KalshiWsSocket, listeners: QuotesSession['listeners']): void {
  for (const { event, cb } of listeners) {
    try {
      sock.off?.(event, cb);
    } catch {
      /* */
    }
  }
  try {
    sock.removeAllListeners?.();
  } catch {
    /* */
  }
}

export function resetKalshiWsQuotesForTests(): void {
  if (session) {
    detach(session.socket, session.listeners);
    try {
      session.socket.close();
    } catch {
      /* */
    }
  }
  session = null;
  connectMutex = null;
  wsConstructCount = 0;
  openKalshiWs = defaultOpen;
}

export function kalshiWsQuotesHealth(nowMs = Date.now()): KalshiWsQuotesHealth {
  if (!session) {
    return { status: 'down', tickers: 0, lastError: null, lastSeqAgeMs: null, fallbackReason: null };
  }
  let newest = 0;
  let ready = 0;
  for (const book of session.books.values()) {
    if (book.ready) {
      ready += 1;
      newest = Math.max(newest, book.updatedAtMs);
    }
  }
  const age = newest ? nowMs - newest : null;
  const status: KalshiWsQuotesHealth['status'] =
    session.socket.readyState === OPEN && ready > 0 ? 'up' : session.fallbackReason ? 'fallback' : 'down';
  return {
    status,
    tickers: session.books.size,
    lastError: session.lastError,
    lastSeqAgeMs: age,
    fallbackReason: session.fallbackReason,
  };
}

export function readWsAskBid(ticker: string, nowMs = Date.now()): WsAskQuote | null {
  const book = session?.books.get(String(ticker || '').trim());
  return readAskBidFromBook(book, nowMs);
}

export function readWsBestBidSize(ticker: string, side: 'YES' | 'NO', nowMs = Date.now()): number | null {
  const book = session?.books.get(String(ticker || '').trim());
  return readBestBidSizeFromBook(book, side, nowMs);
}

function sendCmd(sess: QuotesSession, body: Record<string, unknown>): void {
  sess.cmdId += 1;
  try {
    sess.socket.send(JSON.stringify({ id: sess.cmdId, ...body }));
  } catch (err: any) {
    sess.lastError = String(err?.message || err || 'send_failed');
  }
}

function handleMessage(sess: QuotesSession, raw: unknown): void {
  const data = parseKalshiWsPayload(raw);
  if (!data || typeof data !== 'object') return;
  const type = String(data.type || '');
  const nowMs = Date.now();
  if (type === 'error') {
    const code = data?.msg?.code;
    sess.lastError = String(data?.msg?.msg || `ws_error_${code || ''}`);
    if (Number(code) === 25) {
      sess.fallbackReason = 'buffer_overflow';
      for (const book of sess.books.values()) markBookUnready(book, nowMs);
    }
    return;
  }
  if (type === 'subscribed') {
    const sid = Number(data.msg?.sid ?? data.sid);
    if (Number.isFinite(sid) && sid > 0) sess.sid = sid;
    return;
  }
  const ticker = String(data.msg?.market_ticker || '').trim();
  if (!ticker) return;
  let book = sess.books.get(ticker);
  if (!book) {
    book = emptyTickerBook(nowMs);
    sess.books.set(ticker, book);
  }
  if (type === 'orderbook_snapshot') {
    applyOrderbookSnapshot(book, data.seq, data.msg || {}, nowMs);
    sess.resnapshot.delete(ticker);
    sess.fallbackReason = null;
    return;
  }
  if (type === 'orderbook_delta') {
    const ok = applyOrderbookDelta(book, data.seq, data.msg || {}, nowMs);
    if (!ok) {
      markBookUnready(book, nowMs);
      sess.resnapshot.add(ticker);
      sess.fallbackReason = 'seq_gap';
      if (sess.sid) {
        sendCmd(sess, {
          cmd: 'update_subscription',
          params: { sids: [sess.sid], action: 'get_snapshot', market_tickers: [ticker] },
        });
      }
    }
  }
}

function attach(sess: QuotesSession): void {
  const onMessage = (raw: unknown) => handleMessage(sess, raw);
  const onError = (err: any) => {
    sess.lastError = String(err?.message || err || 'ws_error');
    sess.fallbackReason = 'socket_error';
  };
  const onClose = () => {
    sess.fallbackReason = sess.fallbackReason || 'closed';
    for (const book of sess.books.values()) markBookUnready(book);
  };
  sess.listeners = [
    { event: 'message', cb: onMessage },
    { event: 'error', cb: onError },
    { event: 'close', cb: onClose },
  ];
  sess.socket.on('message', onMessage);
  sess.socket.on('error', onError);
  sess.socket.on('close', onClose);
}

async function connect(opts: {
  keyId: string;
  privateKeyPem: string;
  env?: KalshiEnv;
}): Promise<QuotesSession> {
  wsConstructCount += 1;
  const socket = openKalshiWs(kalshiWsUrl(opts.env || 'production'), kalshiWsAuthHeaders(opts.keyId, opts.privateKeyPem));
  const sess: QuotesSession = {
    socket,
    sid: null,
    cmdId: 0,
    tickers: new Set(),
    books: new Map(),
    lastError: null,
    fallbackReason: null,
    resnapshot: new Set(),
    listeners: [],
  };
  attach(sess);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws_connect_timeout')), 2000);
    const ok = () => {
      clearTimeout(timer);
      resolve();
    };
    const fail = (err: any) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    if (socket.readyState === OPEN) {
      ok();
      return;
    }
    socket.on('open', ok);
    socket.on('error', fail);
  });
  return sess;
}

function syncSubscriptions(sess: QuotesSession, wanted: string[]): void {
  const next = new Set(capTickers(wanted));
  const add: string[] = [];
  const del: string[] = [];
  for (const t of next) if (!sess.tickers.has(t)) add.push(t);
  for (const t of sess.tickers) if (!next.has(t)) del.push(t);
  if (!sess.sid && next.size) {
    sendCmd(sess, { cmd: 'subscribe', params: { channels: ['orderbook_delta'], market_tickers: [...next] } });
    sess.tickers = next;
    for (const t of next) {
      if (!sess.books.has(t)) sess.books.set(t, emptyTickerBook());
    }
    return;
  }
  if (sess.sid && add.length) {
    sendCmd(sess, {
      cmd: 'update_subscription',
      params: { sids: [sess.sid], action: 'add_markets', market_tickers: add },
    });
    for (const t of add) {
      sess.tickers.add(t);
      if (!sess.books.has(t)) sess.books.set(t, emptyTickerBook());
    }
  }
  if (sess.sid && del.length) {
    sendCmd(sess, {
      cmd: 'update_subscription',
      params: { sids: [sess.sid], action: 'delete_markets', market_tickers: del },
    });
    for (const t of del) {
      sess.tickers.delete(t);
      sess.books.delete(t);
    }
  }
}

export async function closeKalshiWsQuotes(): Promise<void> {
  const sess = session;
  session = null;
  if (!sess) return;
  detach(sess.socket, sess.listeners);
  try {
    sess.socket.close();
  } catch {
    /* */
  }
}

/**
 * Keep at most one quotes socket. Flag Off closes it.
 * Trade `/tick` only reads; this is the writer.
 */
export async function pumpKalshiWsQuotes(opts: {
  enabled: boolean;
  tickers: string[];
  keyId?: string;
  privateKeyPem?: string;
  env?: KalshiEnv;
}): Promise<KalshiWsQuotesHealth> {
  if (!opts.enabled) {
    await closeKalshiWsQuotes();
    return kalshiWsQuotesHealth();
  }
  const keyId = String(opts.keyId || '').trim();
  const pem = String(opts.privateKeyPem || '').trim();
  if (!keyId || !pem) {
    await closeKalshiWsQuotes();
    return {
      status: 'down',
      tickers: 0,
      lastError: 'missing_platform_key',
      lastSeqAgeMs: null,
      fallbackReason: 'missing_platform_key',
    };
  }
  const run = async () => {
    if (!session || session.socket.readyState !== OPEN) {
      await closeKalshiWsQuotes();
      session = await connect({ keyId, privateKeyPem: pem, env: opts.env });
    }
    syncSubscriptions(session, opts.tickers);
  };
  if (connectMutex) {
    await connectMutex;
  }
  connectMutex = run().finally(() => {
    connectMutex = null;
  });
  try {
    await connectMutex;
  } catch (err: any) {
    await closeKalshiWsQuotes();
    return {
      status: 'down',
      tickers: 0,
      lastError: String(err?.message || err),
      lastSeqAgeMs: null,
      fallbackReason: 'connect_failed',
    };
  }
  return kalshiWsQuotesHealth();
}

/** Test helper: push a parsed/raw WS payload into the live session. */
export function injectKalshiWsMessageForTests(raw: unknown): void {
  if (!session) return;
  handleMessage(session, raw);
}

export { EventEmitter as KalshiWsEventEmitterForTests };
