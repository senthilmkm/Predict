import { AppConfig, modeLabel } from '../config/types';

export type HomeCloudTone = 'live' | 'stale' | 'idle';

export type HomeStatusPillModel = {
  showAuto: boolean;
  showBell: boolean;
  paused: boolean;
  tickLabel: string;
  tone: HomeCloudTone;
  modeLine: string;
  tickLine: string;
};

export function cloudPulseAgeSec(
  lastPulseAt: string | null | undefined,
  nowMs: number
): number | null {
  if (!lastPulseAt) return null;
  const t = new Date(lastPulseAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 1000));
}

export function isCloudPulseStale(
  running: boolean,
  ageSec: number | null,
  intervalSec: number
): boolean {
  const staleAfter = Math.max(120, intervalSec * 4 + 60);
  return running && ageSec != null && ageSec > staleAfter;
}

export function homeStatusTickLine(opts: {
  running: boolean;
  stale: boolean;
  intervalSec: number;
  ageSec: number | null;
}): string {
  if (!opts.running) return 'Idle';
  const age = opts.ageSec != null ? ` · ${opts.ageSec}s ago` : '';
  if (opts.stale) return `Stale · Cloud tick ${opts.intervalSec}s${age}`;
  return `Live · Cloud tick ${opts.intervalSec}s${age}`;
}

export function homeStatusPillModel(opts: {
  config: Pick<AppConfig, 'auto_trade_enabled' | 'alerts_enabled'>;
  running: boolean;
  lastPulseAt: string | null | undefined;
  intervalSec: number;
  nowMs: number;
}): HomeStatusPillModel {
  const ageSec = cloudPulseAgeSec(opts.lastPulseAt, opts.nowMs);
  const stale = isCloudPulseStale(opts.running, ageSec, opts.intervalSec);
  const tone: HomeCloudTone = !opts.running ? 'idle' : stale ? 'stale' : 'live';
  const tickLabel = !opts.running ? 'Idle' : stale ? 'Stale' : `${opts.intervalSec}s`;
  const autoOn = Boolean(opts.config.auto_trade_enabled);
  const alertsOn = Boolean(opts.config.alerts_enabled);
  return {
    showAuto: autoOn,
    showBell: alertsOn,
    paused: !autoOn && !alertsOn,
    tickLabel,
    tone,
    modeLine: modeLabel(opts.config as AppConfig),
    tickLine: homeStatusTickLine({
      running: opts.running,
      stale,
      intervalSec: opts.intervalSec,
      ageSec,
    }),
  };
}
