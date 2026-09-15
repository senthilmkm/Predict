import { EventEmitter } from 'events';
import forge from 'node-forge';
import { fetchAskQuotesOnce } from '../services/oneSecondMarket';
import {
  injectKalshiWsMessageForTests,
  kalshiWsConstructCountForTests,
  kalshiWsQuotesHealth,
  pumpKalshiWsQuotes,
  readWsAskBid,
  readWsBestBidSize,
  resetKalshiWsQuotesForTests,
  setKalshiWsOpenForTests,
  type KalshiWsSocket,
} from '../services/kalshiWsQuotes';
import { parsePlatformKalshiPayload } from '../services/secretManager';

function testPem(): string {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  return forge.pki.privateKeyToPem(keys.privateKey);
}

class MockWs extends EventEmitter {
  readyState = 1;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
}

describe('kalshiWsQuotes session', () => {
  let pem: string;
  let sockets: MockWs[];

  beforeAll(() => {
    pem = testPem();
  });

  beforeEach(() => {
    sockets = [];
    resetKalshiWsQuotesForTests();
    setKalshiWsOpenForTests(() => {
      const sock = new MockWs();
      sockets.push(sock);
      return sock as unknown as KalshiWsSocket;
    });
  });

  afterEach(async () => {
    await pumpKalshiWsQuotes({ enabled: false, tickers: [] });
    resetKalshiWsQuotesForTests();
  });

  test('flag Off never constructs a socket', async () => {
    await pumpKalshiWsQuotes({ enabled: false, tickers: ['KXBTC15M'], keyId: 'k', privateKeyPem: pem });
    expect(kalshiWsConstructCountForTests()).toBe(0);
    expect(sockets).toHaveLength(0);
  });

  test('flag On without platform key stays down and uses no socket', async () => {
    const health = await pumpKalshiWsQuotes({ enabled: true, tickers: ['KXBTC15M'] });
    expect(health.status).toBe('down');
    expect(health.fallbackReason).toBe('missing_platform_key');
    expect(kalshiWsConstructCountForTests()).toBe(0);
    expect(readWsAskBid('KXBTC15M')).toBeNull();
  });

  test('snapshot then seq-gap fail closed; overlapping pump reuses one socket', async () => {
    const first = await pumpKalshiWsQuotes({
      enabled: true,
      tickers: ['KXBTC15M', 'KXGOLD15M'],
      keyId: 'k',
      privateKeyPem: pem,
    });
    expect(first.status).not.toBe('up');
    expect(kalshiWsConstructCountForTests()).toBe(1);
    expect(sockets[0].sent[0]).toContain('orderbook_delta');
    injectKalshiWsMessageForTests({
      type: 'subscribed',
      msg: { sid: 9 },
    });
    injectKalshiWsMessageForTests({
      type: 'orderbook_snapshot',
      seq: 1,
      msg: { market_ticker: 'KXBTC15M', yes: [['0.61', 4]], no: [['0.40', 8]] },
    });
    expect(readWsAskBid('KXBTC15M')?.yes_ask).toBe(0.6);
    expect(readWsAskBid('KXBTC15M')?.yes_bid).toBe(0.61);
    expect(readWsBestBidSize('KXBTC15M', 'NO')).toBe(8);
    expect(kalshiWsQuotesHealth().status).toBe('up');
    injectKalshiWsMessageForTests({
      type: 'orderbook_delta',
      seq: 3,
      msg: { market_ticker: 'KXBTC15M', side: 'yes', price_dollars: '0.61', delta_fp: 1 },
    });
    expect(readWsAskBid('KXBTC15M')).toBeNull();
    expect(sockets[0].sent.some((row) => row.includes('get_snapshot'))).toBe(true);

    await pumpKalshiWsQuotes({
      enabled: true,
      tickers: ['KXBTC15M'],
      keyId: 'k',
      privateKeyPem: pem,
    });
    expect(kalshiWsConstructCountForTests()).toBe(1);
    expect(sockets).toHaveLength(1);
  });

  test('fetchAskQuotesOnce prefers a healthy WS book and skips REST', async () => {
    await pumpKalshiWsQuotes({
      enabled: true,
      tickers: ['KXBTC15M'],
      keyId: 'k',
      privateKeyPem: pem,
    });
    injectKalshiWsMessageForTests({
      type: 'orderbook_snapshot',
      seq: 1,
      msg: { market_ticker: 'KXBTC15M', yes: [['0.55', 2]], no: [['0.44', 3]] },
    });
    const fetchQuote = jest.fn(async () => ({ yes_ask_dollars: 0.99, no_ask_dollars: 0.01 }));
    const quotes = await fetchAskQuotesOnce(['KXBTC15M'], fetchQuote);
    expect(fetchQuote).not.toHaveBeenCalled();
    expect(quotes.get('KXBTC15M')).toMatchObject({ yes_ask: 0.56, no_ask: 0.45, yes_bid: 0.55, no_bid: 0.44 });
  });
});

describe('platform Kalshi secret parse', () => {
  test('accepts JSON keyId + pem and rejects junk', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';
    expect(parsePlatformKalshiPayload(JSON.stringify({ keyId: 'id1', privateKeyPem: pem }))).toEqual({
      keyId: 'id1',
      privateKeyPem: pem,
    });
    expect(parsePlatformKalshiPayload('')).toBeNull();
    expect(parsePlatformKalshiPayload('UNSET')).toBeNull();
    expect(parsePlatformKalshiPayload(JSON.stringify({ keyId: 'id1', privateKeyPem: 'nope' }))).toBeNull();
  });
});
