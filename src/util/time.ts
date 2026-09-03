/** YYYY-MM-DD in America/New_York */
export function etDateKey(d = new Date()): string {
  try {
    return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function isEtToday(iso: string, now = new Date()): boolean {
  try {
    return etDateKey(new Date(iso)) === etDateKey(now);
  } catch {
    return false;
  }
}
