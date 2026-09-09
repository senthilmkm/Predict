import {
  getSystemConfig,
  MAX_PURGE_DELETES_PER_TICK,
  normalizePurgeConfig,
  invalidatePurgeCollectionCountsCache,
  runSubcollectionPurge,
  type PurgeDeletedCounts,
  type SystemConfig,
} from './firestore';

export type PurgeJobName = 'audit' | 'alerts' | 'trades';

const ZERO_DELETED: PurgeDeletedCounts = { audit: 0, alerts: 0, trades: 0 };

let purgeInFlight = false;

export function setPurgeInFlightForTests(value: boolean): void {
  purgeInFlight = value;
}

export function parsePurgeJobName(raw: unknown): PurgeJobName | 'all' | null {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  if (v === 'audit' || v === 'alerts' || v === 'trades' || v === 'all') return v;
  return null;
}

export async function runConfiguredPurgeJobs(options?: {
  jobs?: PurgeJobName[];
  ignoreEnabled?: boolean;
  maxDeletes?: number;
  config?: SystemConfig;
}): Promise<{
  skipped: boolean;
  ran: boolean;
  deleted: PurgeDeletedCounts;
  scannedUsers: number;
}> {
  if (purgeInFlight) {
    return { skipped: true, ran: false, deleted: { ...ZERO_DELETED }, scannedUsers: 0 };
  }
  purgeInFlight = true;
  try {
    const cfg = options?.config || (await getSystemConfig());
    const purge = normalizePurgeConfig(cfg.purge);
    const wanted = options?.jobs?.length ? options.jobs : (['audit', 'alerts', 'trades'] as PurgeJobName[]);
    const ignore = Boolean(options?.ignoreEnabled);
    const pass = {
      audit:
        wanted.includes('audit') && (ignore || purge.audit.enabled)
          ? { retainDays: purge.audit.retainDays }
          : undefined,
      alerts:
        wanted.includes('alerts') && (ignore || purge.alerts.enabled)
          ? { retainDays: purge.alerts.retainDays }
          : undefined,
      trades:
        wanted.includes('trades') && (ignore || purge.trades.enabled)
          ? { retainDays: purge.trades.retainDays }
          : undefined,
      maxDeletes: options?.maxDeletes ?? MAX_PURGE_DELETES_PER_TICK,
    };
    if (!pass.audit && !pass.alerts && !pass.trades) {
      return { skipped: false, ran: false, deleted: { ...ZERO_DELETED }, scannedUsers: 0 };
    }
    const result = await runSubcollectionPurge(pass);
    invalidatePurgeCollectionCountsCache();
    return { skipped: false, ran: true, deleted: result.deleted, scannedUsers: result.scannedUsers };
  } finally {
    purgeInFlight = false;
  }
}
