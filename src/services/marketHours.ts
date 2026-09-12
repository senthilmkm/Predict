import { AssetKey, AssetRegistry } from '../config/types';

export interface MarketHoursResult {
  open: boolean;
  reason?: string;
  reopensAt?: string;
}

// Known CME Commodity Holidays (YYYY-MM-DD in ET)
const CME_HOLIDAYS = new Set([
  '2026-01-01', // New Year's Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-07-03', // Independence Day (Observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving Day
  '2026-12-25', // Christmas Day
  '2027-01-01', // New Year's Day 2027
]);

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
    // Handle hour '24' edge case in some Intl implementations
    let hour = parseInt(map.hour, 10);
    if (hour === 24) hour = 0;
    const minute = parseInt(map.minute, 10);
    const monthDay = `${map.year}-${map.month}-${map.day}`;
    return { weekday: map.weekday, hour, minute, monthDay };
  } catch {
    // Resilient fallback to local time if Intl format fails
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
 * Evaluates whether we should poll this asset.
 * - Crypto: 24/7
 * - Kalshi 15m commodities (Gold, WTI, Silver, Copper, NG): always poll.
 *   Kalshi lists Friday-night (and other) books after CME futures close.
 *   No open Kalshi event → lean shows no market. Do not hard-close on CME weekend.
 * - Stocks / forex: exchange hours only
 */
export function isMarketOpen(asset: AssetKey, date: Date = new Date()): MarketHoursResult {
  const scheduleType = AssetRegistry.getScheduleType(asset);
  if (scheduleType === 'CRYPTO_24_7' || scheduleType === 'CME_COMMODITY') {
    return { open: true };
  }

  const { weekday, hour, minute, monthDay } = getETParts(date);

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

/**
 * Returns human notice for full-day closures (Weekends & Holidays).
 * Used for Home Screen banner underneath Heartbeat Chip.
 */
export function getMarketScheduleNotice(date: Date = new Date()): string | null {
  const { weekday, hour, monthDay } = getETParts(date);

  if (CME_HOLIDAYS.has(monthDay)) {
    return 'Stock indices are closed for the holiday. Crypto and Kalshi commodity 15m books still poll when Kalshi lists them.';
  }

  const isWeekend =
    weekday === 'Sat' ||
    (weekday === 'Fri' && hour >= 17) ||
    (weekday === 'Sun' && hour < 18);

  if (isWeekend) {
    return 'Stock indices and forex are closed for the weekend. Crypto and Kalshi commodity 15m books still poll when Kalshi lists them. Stock indices reopen Mon 9:30 AM ET.';
  }

  return null;
}
