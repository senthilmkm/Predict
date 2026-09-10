import { AppConfig, AssetKey } from '../config/types';
import { snapshotConfig } from '../config/normalize';
import {
  evaluateStaticGate as evaluateCoreGate,
  GateResult as CoreGateResult,
  LeanSignal as CoreLeanSignal,
  windowBuyCap,
} from '../../packages/trading-core/src/gates';

export type { GateResult } from '../../packages/trading-core/src/gates';
export { windowBuyCap };

export interface LeanSignal {
  asset: AssetKey;
  market_ticker: string;
  decision: 'YES' | 'NO' | 'SKIP';
  live: number;
  strike: number;
  abs_gap: number;
  minutes_left: number;
  /** Whole minutes since the 15m window opened (0 at the open). */
  minutes_elapsed?: number;
  phase: 'live' | 'ended';
  yes_ask?: number;
  no_ask?: number;
  timeseries?: { t: number; v: number }[];
  minutes_remaining?: number;
}

/**
 * Static-cushion gate aligned with Kalshi / Predict Tab risk fields.
 * Auto Smart buy lives in trading-core so Cloud and the phone cannot drift.
 */
export function evaluateStaticGate(
  lean: LeanSignal,
  cfgIn: AppConfig,
  opts?: {
    openPositions?: number;
    dailyPnlUsd?: number;
    tradesToday?: number;
    assetTradesInWindow?: number;
    allowWhenAutoTradeOff?: boolean;
  }
): CoreGateResult {
  const cfg = snapshotConfig(cfgIn);
  return evaluateCoreGate(lean as CoreLeanSignal, cfg as Parameters<typeof evaluateCoreGate>[1], opts);
}
