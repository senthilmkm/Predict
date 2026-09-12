import { AssetRegistry } from 'trading-core';

export interface MarketHoursResult {
  open: boolean;
  reason?: string;
  reopensAt?: string;
}

export function getETParts(date: Date = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const map: Record<string, string> = {};
    for (const p of parts) {
      map[p.type] = p.value;
    }
    let hour = parseInt(map.hour, 10);
    if (hour === 24) hour = 0;
    const minute = parseInt(map.minute, 10);
    const monthDay = `${map.year}-${map.month}-${map.day}`;
    return { weekday: map.weekday, hour, minute, monthDay };
  } catch {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
      weekday: dayNames[date.getDay()],
      hour: date.getHours(),
      minute: date.getMinutes(),
      monthDay: date.toISOString().split('T')[0],
    };
  }
}

/**
 * Evaluates whether Cloud should poll this asset.
 * - Crypto: 24/7
 * - Kalshi 15m commodities: always poll (Kalshi lists Friday-night books after CME close)
 * - Stocks / forex: exchange hours only
 */
function getSchedule(asset: string): string {
  if (['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'BNB', 'AVAX', 'SUI', 'LINK'].includes(asset)) return 'CRYPTO_24_7';
  if (['SPX', 'NDX'].includes(asset)) return 'US_STOCK_HOURS';
  if (['EURUSD', 'GBPUSD', 'USDJPY'].includes(asset)) return 'FOREX_HOURS';
  if (['WTI', 'Gold', 'Silver', 'COPPER', 'NG'].includes(asset)) return 'CME_COMMODITY';
  try {
    if (typeof AssetRegistry?.get === 'function') {
      const def = AssetRegistry.get(asset);
      if (def?.scheduleType) return def.scheduleType;
    }
  } catch { /* fall through */ }
  return 'CRYPTO_24_7';
}

export function isMarketOpen(asset: string, date: Date = new Date()): MarketHoursResult {
  const scheduleType = getSchedule(asset);
  if (scheduleType === 'CRYPTO_24_7' || scheduleType === 'CME_COMMODITY') {
    return { open: true };
  }

  const { weekday, hour, minute } = getETParts(date);

  if (scheduleType === 'US_STOCK_HOURS') {
    if (['Sat', 'Sun'].includes(weekday)) {
      return { open: false, reason: 'Weekend halt', reopensAt: 'Mon 9:30 AM ET' };
    }
    const mins = hour * 60 + minute;
    if (mins < 570 || mins >= 960) {
      return { open: false, reason: 'Outside US stock hours (9:30 AM - 4:00 PM ET)', reopensAt: '9:30 AM ET' };
    }
    return { open: true };
  }

  if (scheduleType === 'FOREX_HOURS') {
    if (weekday === 'Sat' || (weekday === 'Fri' && hour >= 17) || (weekday === 'Sun' && hour < 17)) {
      return { open: false, reason: 'Forex weekend halt', reopensAt: 'Sun 5:00 PM ET' };
    }
    return { open: true };
  }

  return { open: true };
}
