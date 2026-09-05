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
 * Evaluates whether market is open for trading & signal polling.
 * - BTC & ETH: 24/7 (Always OPEN)
 * - WTI, Gold, Silver (CME Futures):
 *   - Friday 5:00 PM ET -> Sunday 6:00 PM ET: CLOSED (Weekend)
 *   - Mon-Thu 5:00 PM ET -> 6:00 PM ET: CLOSED (Daily CME Halt)
 *   - Holidays: CLOSED
 */
export function isMarketOpen(asset: AssetKey, date: Date = new Date()): MarketHoursResult {
  const scheduleType = AssetRegistry.getScheduleType(asset);
  if (scheduleType === 'CRYPTO_24_7') {
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

  // CME Holidays
  if (CME_HOLIDAYS.has(monthDay)) {
    return {
      open: false,
      reason: 'CME Market Holiday',
      reopensAt: 'Next Business Day 6:00 PM ET',
    };
  }

  // Saturday (Full Day Closed)
  if (weekday === 'Sat') {
    return {
      open: false,
      reason: 'Weekend halt',
      reopensAt: 'Sun 6:00 PM ET',
    };
  }

  // Friday Evening (Closed 5:00 PM ET onwards)
  if (weekday === 'Fri' && hour >= 17) {
    return {
      open: false,
      reason: 'Weekend halt',
      reopensAt: 'Sun 6:00 PM ET',
    };
  }

  // Sunday Before 6:00 PM ET
  if (weekday === 'Sun' && hour < 18) {
    return {
      open: false,
      reason: 'Weekend halt',
      reopensAt: 'Sun 6:00 PM ET',
    };
  }

  // Monday–Thursday Daily Maintenance Halt (5:00 PM ET – 6:00 PM ET)
  if (['Mon', 'Tue', 'Wed', 'Thu'].includes(weekday) && hour === 17) {
    return {
      open: false,
      reason: 'Daily CME halt',
      reopensAt: '6:00 PM ET',
    };
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
    return 'Commodity, Stock & Forex markets are closed for the holiday. Polling active for 24/7 Crypto (BTC, ETH, SOL, DOGE, XRP, BNB, AVAX, SUI, LINK). Non-crypto assets reopen next business day.';
  }

  const isWeekend =
    weekday === 'Sat' ||
    (weekday === 'Fri' && hour >= 17) ||
    (weekday === 'Sun' && hour < 18);

  if (isWeekend) {
    return 'Commodity, Stock & Forex markets are closed for the weekend. Polling active for 24/7 Crypto (BTC, ETH, SOL, DOGE, XRP, BNB, AVAX, SUI, LINK). Forex reopens Sun 5:00 PM ET; Commodities Sun 6:00 PM ET; Stock Indices Mon 9:30 AM ET.';
  }

  return null;
}
