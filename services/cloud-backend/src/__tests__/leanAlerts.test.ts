import {
  claimLeanAlert,
  fillCollapseId,
  fillPushEnabled,
  leanAlertKey,
  leanAlertPushTokens,
  leanCollapseId,
  leanPushEnabled,
  pruneLeanAlertsSent,
} from '../services/leanAlerts';

describe('leanAlerts — one ding per contract per side', () => {
  const ticker = 'KXBTC15M-26SEP071145-45';
  const now = new Date('2026-09-07T15:32:00.000Z');

  test('key is ticker + side', () => {
    expect(leanAlertKey(ticker, 'yes')).toBe(`${ticker}:YES`);
    expect(leanAlertKey(ticker, 'NO')).toBe(`${ticker}:NO`);
  });

  test('first YES is sent; same YES 20s later is not', () => {
    const first = claimLeanAlert({}, ticker, 'YES', now);
    expect(first.send).toBe(true);
    const later = claimLeanAlert(first.next, ticker, 'YES', new Date(now.getTime() + 20_000));
    expect(later.send).toBe(false);
    expect(Object.keys(later.next)).toEqual([`${ticker}:YES`]);
  });

  test('flip to NO in the same window sends once', () => {
    const yes = claimLeanAlert({}, ticker, 'YES', now);
    const no = claimLeanAlert(yes.next, ticker, 'NO', new Date(now.getTime() + 40_000));
    expect(no.send).toBe(true);
    const noAgain = claimLeanAlert(no.next, ticker, 'NO', new Date(now.getTime() + 60_000));
    expect(noAgain.send).toBe(false);
  });

  test('next 15m contract (new ticker) can ding again', () => {
    const first = claimLeanAlert({}, ticker, 'YES', now);
    const nextWindow = claimLeanAlert(
      first.next,
      'KXBTC15M-26SEP071200-45',
      'YES',
      new Date(now.getTime() + 13 * 60_000)
    );
    expect(nextWindow.send).toBe(true);
  });

  test('ETH is independent of BTC', () => {
    const btc = claimLeanAlert({}, ticker, 'YES', now);
    const eth = claimLeanAlert(btc.next, 'KXETH15M-26SEP071145-45', 'YES', now);
    expect(eth.send).toBe(true);
  });

  test('missing ticker or side never sends', () => {
    expect(claimLeanAlert({}, '', 'YES', now).send).toBe(false);
    expect(claimLeanAlert({}, ticker, 'SKIP', now).send).toBe(false);
  });

  test('stale keys older than 45m are pruned so a later window is not blocked by junk', () => {
    const stale = {
      'OLD-TICKER:YES': new Date(now.getTime() - 46 * 60_000).toISOString(),
    };
    const pruned = pruneLeanAlertsSent(stale, now);
    expect(pruned).toEqual({});
    expect(claimLeanAlert(stale, ticker, 'YES', now).send).toBe(true);
  });

  test('below-cushion leans get no push tokens', () => {
    const tokens = ['ExponentPushToken[a]'];
    expect(leanAlertPushTokens(6.99, 7, tokens)).toEqual([]);
    expect(leanAlertPushTokens(7, 7, tokens)).toEqual(tokens);
    expect(leanAlertPushTokens(10, 7, tokens)).toEqual(tokens);
  });

  test('lean push respects alerts_enabled and mute prefs', () => {
    expect(leanPushEnabled({ alerts_enabled: true })).toBe(true);
    expect(leanPushEnabled({ alerts_enabled: false })).toBe(false);
    expect(
      leanPushEnabled({ alerts_enabled: true, alert_prefs: { lean_signal: { enabled: true, push: false } } })
    ).toBe(false);
    expect(
      leanPushEnabled({ alerts_enabled: true, alert_prefs: { lean_signal: { enabled: false, push: true } } })
    ).toBe(false);
  });

  test('fill push can be muted without muting leans', () => {
    expect(fillPushEnabled({ alerts_enabled: true })).toBe(true);
    expect(
      fillPushEnabled({ alerts_enabled: true, alert_prefs: { order_filled: { enabled: true, push: false } } })
    ).toBe(false);
    expect(
      leanPushEnabled({ alerts_enabled: true, alert_prefs: { order_filled: { enabled: true, push: false } } })
    ).toBe(true);
  });

  test('collapse ids stay within APNs 64-byte cap', () => {
    const longUser = 'usr_' + 'x'.repeat(80);
    const longKey = leanAlertKey('KXBTC15M-' + 'Z'.repeat(80), 'YES');
    expect(leanCollapseId(longUser, longKey).length).toBeLessThanOrEqual(64);
    expect(fillCollapseId(longUser, 'trade_' + 'z'.repeat(80)).length).toBeLessThanOrEqual(64);
    expect(leanCollapseId('usr_a', `${ticker}:YES`)).toContain('lean:');
  });
});
