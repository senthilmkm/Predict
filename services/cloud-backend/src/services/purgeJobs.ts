import {
  getSystemConfig,
  MAX_PURGE_DELETES_PER_TICK,
  normalizePurgeConfig,
  invalidatePurgeCollectionCountsCache,
  runSubcollectionPurge,
  type PurgeConfig,
  type PurgeDeletedCounts,
  type PurgeJobSettings,
  type SystemConfig,
} from './firestore';

export type PurgeJobName = 'audit' | 'alerts' | 'trades';

/** Cloud Scheduler fires POST /tick once a minute; a due job runs at the end of that minute. */
export const CLOUD_SCHEDULER_TICK_MS = 60_000;
export const PURGE_DAY_MS = 24 * 60 * 60 * 1000;

const ZERO_DELETED: PurgeDeletedCounts = { audit: 0, alerts: 0, trades: 0 };

export function purgeJobIsDue(job: Pick<PurgeJobSettings, 'intervalDays' | 'lastRunAt'>, nowMs = Date.now()): boolean {
  if (!job.lastRunAt) return true;
  const last = Date.parse(job.lastRunAt);
  if (!Number.isFinite(last)) return true;
  const wait = Math.max(1, Math.round(Number(job.intervalDays) || 1)) * PURGE_DAY_MS;
  return nowMs >= last + wait;
}

export function nextPurgeJobAtMs(
  job: Pick<PurgeJobSettings, 'enabled' | 'intervalDays' | 'lastRunAt'>,
  nowMs = Date.now()
): number | null {
  if (!job.enabled) return null;
  if (purgeJobIsDue(job, nowMs)) return nowMs;
  const last = Date.parse(String(job.lastRunAt || ''));
  if (!Number.isFinite(last)) return nowMs;
  return last + Math.max(1, Math.round(Number(job.intervalDays) || 1)) * PURGE_DAY_MS;
}

export function nextSoonestPurgeAtMs(purge: PurgeConfig, nowMs = Date.now()): number | null {
  const times = (['audit', 'alerts', 'trades'] as const)
    .map((key) => nextPurgeJobAtMs(purge[key], nowMs))
    .filter((n): n is number => n != null);
  if (!times.length) return null;
  return Math.min(...times);
}

export function purgeLastRunPatch(
  ranJobs: PurgeJobName[],
  deleted: PurgeDeletedCounts,
  nowIso: string
): Partial<PurgeConfig> {
  const patch: Partial<PurgeConfig> = {
    lastRunAt: nowIso,
    lastDeleted: deleted,
  };
  for (const job of ranJobs) {
    patch[job] = { lastRunAt: nowIso } as PurgeJobSettings;
  }
  return patch;
}

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
  ranJobs: PurgeJobName[];
  deleted: PurgeDeletedCounts;
  scannedUsers: number;
}> {
  if (purgeInFlight) {
    return { skipped: true, ran: false, ranJobs: [], deleted: { ...ZERO_DELETED }, scannedUsers: 0 };
  }
  purgeInFlight = true;
  try {
    const cfg = options?.config || (await getSystemConfig());
    const purge = normalizePurgeConfig(cfg.purge);
    const wanted = options?.jobs?.length ? options.jobs : (['audit', 'alerts', 'trades'] as PurgeJobName[]);
    const ignore = Boolean(options?.ignoreEnabled);
    const nowMs = Date.now();
    const take = (name: PurgeJobName) => {
      if (!wanted.includes(name)) return undefined;
      const job = purge[name];
      if (ignore) return { retainDays: job.retainDays };
      if (!job.enabled || !purgeJobIsDue(job, nowMs)) return undefined;
      return { retainDays: job.retainDays };
    };
    const pass = {
      audit: take('audit'),
      alerts: take('alerts'),
      trades: take('trades'),
      maxDeletes: options?.maxDeletes ?? MAX_PURGE_DELETES_PER_TICK,
    };
    const ranJobs = (['audit', 'alerts', 'trades'] as PurgeJobName[]).filter((name) => pass[name]);
    if (!ranJobs.length) {
      return { skipped: false, ran: false, ranJobs: [], deleted: { ...ZERO_DELETED }, scannedUsers: 0 };
    }
    const result = await runSubcollectionPurge(pass);
    invalidatePurgeCollectionCountsCache();
    return { skipped: false, ran: true, ranJobs, deleted: result.deleted, scannedUsers: result.scannedUsers };
  } finally {
    purgeInFlight = false;
  }
}
