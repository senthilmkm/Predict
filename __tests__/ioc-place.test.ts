import { iocKalshiPrice, refreshIocPayForPlace, homeBuyPayFromLiveAsk } from '../packages/trading-core/src/iocPlace';

describe('refreshIocPayForPlace', () => {
  const quotes = { yes_ask: 0.52, no_ask: 0.41 };

  test('keeps quoted pay when live ask is unchanged or cheaper', () => {
    expect(
      refreshIocPayForPlace({
        decision: 'YES',
        quotedPayUsd: 0.52,
        maxPayUsd: 0.7,
        quotes,
        allowBump: true,
      })
    ).toEqual({ ok: true, payUsd: 0.52, bumped: false });
    expect(
      refreshIocPayForPlace({
        decision: 'YES',
        quotedPayUsd: 0.52,
        maxPayUsd: 0.7,
        quotes: { yes_ask: 0.51, no_ask: 0.41 },
        allowBump: true,
      })
    ).toEqual({ ok: true, payUsd: 0.52, bumped: false });
  });

  test('bumps 1¢ when allowBump and still under max', () => {
    expect(
      refreshIocPayForPlace({
        decision: 'YES',
        quotedPayUsd: 0.52,
        maxPayUsd: 0.7,
        quotes: { yes_ask: 0.53 },
        allowBump: true,
      })
    ).toEqual({ ok: true, payUsd: 0.53, bumped: true });
  });

  test('skips when the ask walked without bump, or more than 1¢, or past max', () => {
    expect(
      refreshIocPayForPlace({
        decision: 'YES',
        quotedPayUsd: 0.52,
        maxPayUsd: 0.7,
        quotes: { yes_ask: 0.53 },
        allowBump: false,
      })
    ).toEqual({ ok: false, skip_reason: 'ask_moved' });
    expect(
      refreshIocPayForPlace({
        decision: 'YES',
        quotedPayUsd: 0.52,
        maxPayUsd: 0.7,
        quotes: { yes_ask: 0.54 },
        allowBump: true,
      })
    ).toEqual({ ok: false, skip_reason: 'ask_moved' });
    expect(
      refreshIocPayForPlace({
        decision: 'YES',
        quotedPayUsd: 0.52,
        maxPayUsd: 0.52,
        quotes: { yes_ask: 0.53 },
        allowBump: true,
      })
    ).toEqual({ ok: false, skip_reason: 'ask_moved' });
  });

  test('no live book keeps the quoted pay', () => {
    expect(
      refreshIocPayForPlace({
        decision: 'NO',
        quotedPayUsd: 0.4,
        maxPayUsd: 0.6,
        quotes: null,
        allowBump: true,
      })
    ).toEqual({ ok: true, payUsd: 0.4, bumped: false });
  });
});

describe('iocKalshiPrice', () => {
  test('YES is bid at pay; NO is ask at pay', () => {
    expect(iocKalshiPrice({ decision: 'YES', payUsd: 0.53 })).toEqual({ side: 'bid', price: '0.53' });
    expect(iocKalshiPrice({ decision: 'NO', payUsd: 0.41 })).toEqual({ side: 'ask', price: '0.41' });
    expect(
      iocKalshiPrice({
        decision: 'NO',
        payUsd: 0.42,
        existingSide: 'ask',
        existingPrice: 0.6,
        existingPayUsd: 0.4,
      })
    ).toEqual({ side: 'ask', price: '0.42' });
  });
});

describe('homeBuyPayFromLiveAsk', () => {
  test('pays live ask + chase capped by max entry', () => {
    expect(
      homeBuyPayFromLiveAsk({ liveAskUsd: 0.5, chaseUsd: 0.02, maxEntryAskUsd: 0.9 })
    ).toEqual({ ok: true, payUsd: 0.52 });
    expect(
      homeBuyPayFromLiveAsk({ liveAskUsd: 0.89, chaseUsd: 0.02, maxEntryAskUsd: 0.9 })
    ).toEqual({ ok: true, payUsd: 0.9 });
    expect(
      homeBuyPayFromLiveAsk({ liveAskUsd: 0.91, chaseUsd: 0.02, maxEntryAskUsd: 0.9 })
    ).toEqual({ ok: false, skip_reason: 'ask_moved' });
    expect(homeBuyPayFromLiveAsk({ liveAskUsd: null, chaseUsd: 0.02 })).toEqual({
      ok: false,
      skip_reason: 'ask_unavailable',
    });
  });
});
