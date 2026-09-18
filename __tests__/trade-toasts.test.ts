import { toastFromAlert, toastFromManualTrade, toastFromTradeRecord } from '../src/screens/tradeToasts';

describe('tradeToasts', () => {
  test('manual buy/sell chips', () => {
    expect(toastFromManualTrade({ asset: 'BTC', action: 'buy', side: 'YES' })).toMatchObject({
      action: 'buy',
      asset: 'BTC',
      side: 'YES',
      pathLabel: 'Home Buy',
    });
    expect(toastFromManualTrade({ asset: 'ETH', action: 'sell', side: 'NO' }).pathLabel).toBe(
      'Home Sell'
    );
  });

  test('order_filled alert → buy toast', () => {
    const t = toastFromAlert({
      id: 'a1',
      at: new Date().toISOString(),
      kind: 'order_filled',
      title: 'Order Placed · Last-minute · BTC YES',
      body: '5 ctr @ $0.90',
      read: false,
    });
    expect(t).toMatchObject({
      action: 'buy',
      asset: 'BTC',
      side: 'YES',
      pathLabel: 'Last-minute',
    });
  });

  test('protect_sell alert → sell toast', () => {
    const t = toastFromAlert({
      id: 'a2',
      at: new Date().toISOString(),
      kind: 'protect_sell',
      title: 'Protect sold · Buffer run · ETH YES',
      body: 'Sold',
      read: false,
    });
    expect(t).toMatchObject({
      action: 'sell',
      asset: 'ETH',
      side: 'YES',
    });
  });

  test('trade record fill → buy toast', () => {
    const t = toastFromTradeRecord({
      id: 't1',
      at: new Date().toISOString(),
      asset: 'BTC',
      market_ticker: 'X',
      side: 'YES',
      notional_usd: 5,
      fill_count: 5,
      outcome: 'pending',
      dry_run: false,
      entry_path: 'last_minute',
    });
    expect(t).toMatchObject({ action: 'buy', asset: 'BTC', pathLabel: 'Last-minute' });
  });
});
