import {
  AppConfig,
  AssetKey,
  CUSHION_BOUNDS,
  DEFAULT_CUSHIONS,
  defaultAppConfig,
  ExecutionMode,
  POLL_INTERVAL_DEFAULT_SEC,
  POLL_INTERVAL_MAX_SEC,
  POLL_INTERVAL_MIN_SEC,
  ALERT_RETENTION_DEFAULT_DAYS,
  ALERT_RETENTION_MAX_DAYS,
  ALERT_RETENTION_MIN_DAYS,
  RiskConfig,
  TimeInForce,
} from './types';
import { DEFAULT_RISK_CONFIG } from './riskDefaults';
import {
  cashOutTradeDollars,
  normalizeCashOutAssets,
  normalizeCashOutBid,
  normalizeCashOutEnterPct,
  normalizeCashOutMaxAsk,
  normalizeCashOutStopUsd,
  reconcileCashOutTargets,
} from '../../packages/trading-core/src/cashOut';
import { inheritSkipThinBid } from '../../packages/trading-core/src/skipThinBid';
import {
  normalizeGoldFadeFlattenMinutes,
  normalizeGoldFadeMaxAskUsd,
  normalizeGoldFadeMaxGapUsd,
  normalizeGoldFadeStopUsd,
  goldFadeTradeDollars,
  normalizeGoldFadeTakeUsd,
} from '../../packages/trading-core/src/goldFade';
import {
  normalizeTwapLockAssets,
  normalizeTwapLockMaxAskUsd,
  twapLockTradeDollars,
} from '../../packages/trading-core/src/twapLock';
import {
  normalizeLastMinuteAssets,
  normalizeLastMinuteBothGap,
  normalizeLastMinuteBothMinAsk,
  normalizeLastMinuteClipCount,
  normalizeLastMinuteEnterSeconds,
  normalizeLastMinuteLadderSeconds,
  normalizeLastMinuteMaxAskUsd,
  normalizeLastMinuteMaxClips,
  normalizeLastMinuteSide,
  normalizeLastMinuteStopSeconds,
  normalizeLastMinuteWatchSeconds,
  normalizeLastMinuteFlipSellUsd,
} from '../../packages/trading-core/src/lastMinute';
import {
  normalizeLastMinuteAtrAskUsd,
  normalizeLastMinuteAtrMult,
} from '../../packages/trading-core/src/lateAtrCushion';
import { normalizeSellAtPct } from '../../packages/trading-core/src/protectSell';
import {
  normalizeStepBuyAddBandUsd,
  normalizeStepBuyAddCushionPct,
  normalizeStepBuyAddWaitMinutes,
  normalizeStepBuyAssets,
  normalizeStepBuyCushionPct,
  normalizeStepBuyLotCount,
  normalizeStepBuyMaxAskUsd,
  normalizeStepBuyMaxLots,
  normalizeStepBuySellIfThesisDies,
  normalizeStepBuyStartMinutes,
  normalizeStepBuyStopUsd,
} from '../../packages/trading-core/src/stepBuy';
import {
  normalizeSpikeFadeAssets,
  normalizeSpikeFadeCheapMaxUsd,
  normalizeSpikeFadeCheapMinUsd,
  normalizeSpikeFadeExpensiveMaxUsd,
  normalizeSpikeFadeExpensiveMinUsd,
  normalizeSpikeFadeFlattenMinutes,
  normalizeSpikeFadeLotCount,
  normalizeSpikeFadeStartMinutes,
  normalizeSpikeFadeStopAskUsd,
  normalizeSpikeFadeTakeAskUsd,
  normalizeSpikeFadeUntilMinutes,
  reconcileSpikeFadeBands,
} from '../../packages/trading-core/src/spikeFade';
import {
  normalizePairLockAssets,
  normalizePairLockFlattenMinutes,
  normalizePairLockLotCount,
  normalizePairLockAddPairs,
  normalizePairLockMinLockUsd,
  normalizePairLockRecoverSeconds,
  normalizePairLockRunnerMaxAskUsd,
  normalizePairLockRunnerStopUsd,
  normalizePairLockStartMinutes,
  normalizePairLockUntilMinutes,
  reconcilePairLockWindow,
} from '../../packages/trading-core/src/pairLock';
import {
  isCapLockAllowLater,
  normalizeCapLockAssets,
  normalizeCapLockLotCount,
  normalizeCapLockMaxLossUsd,
  normalizeCapLockWindowOpenSeconds,
} from '../../packages/trading-core/src/capLock';
import {
  normalizeBufferRunAskMaxUsd,
  normalizeBufferRunAskMinUsd,
  normalizeBufferRunAssets,
  normalizeBufferRunAtrMult,
  normalizeBufferRunDollars,
  normalizeBufferRunEnterElapsedMinutes,
  normalizeBufferRunEnterLeftMinutes,
  normalizeBufferRunFlattenMinutes,
  normalizeBufferRunMinGapBtcUsd,
  normalizeBufferRunMinGapEthUsd,
  normalizeBufferRunPairSumSkip,
  normalizeBufferRunStopUsd,
  normalizeBufferRunTakeUsd,
  reconcileBufferRunAskBand,
  reconcileBufferRunTakeStop,
  reconcileBufferRunTiming,
} from '../../packages/trading-core/src/bufferRun';
import {
  normalizeCheapLoopAssets,
  normalizeCheapLoopCheapMaxAskUsd,
  normalizeCheapLoopCooldownMinutes,
  normalizeCheapLoopCycles,
  normalizeCheapLoopFlattenMinutes,
  normalizeCheapLoopLotCount,
  normalizeCheapLoopMinLiveCushionPct,
  normalizeCheapLoopMinGapUsd,
  normalizeCheapLoopMinHoldMinutes,
  normalizeCheapLoopStartMinutes,
  normalizeCheapLoopStopUsd,
  normalizeCheapLoopTakeUsd,
  reconcileCheapLoopTakeStop,
  normalizeCheapLoopHourlyAssets,
  normalizeCheapLoopHourlyCooldownMinutes,
  normalizeCheapLoopHourlyCycles,
  normalizeCheapLoopHourlyMinHoldMinutes,
  normalizeCheapLoopHourlyStartMinutes,
  normalizeCheapLoopWeeklyAssets,
  normalizeCheapLoopWeeklyCycles,
  normalizeCheapLoopWeeklyFlattenMinutes,
} from '../../packages/trading-core/src/cheapLoop';
import {
  configForHomeBuy as mergeHomeBuyRisk,
  normalizeManualPathRisk,
} from '../../packages/trading-core/src/pathRisk';
import { ManualPathRisk } from './types';

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function snap(n: number, step: number): number {
  if (step <= 0) return n;
  const rounded = Math.round(n / step) * step;
  const decimals = String(step).includes('.')
    ? String(step).split('.')[1].length
    : 0;
  return Number(rounded.toFixed(decimals));
}

export function clampCushion(asset: AssetKey, value: number): number {
  const b = CUSHION_BOUNDS[asset];
  return snap(clamp(value, b.min, b.max), b.step);
}

export function clampPollIntervalSeconds(raw: number): number {
  return Math.round(
    clamp(Number(raw) || POLL_INTERVAL_DEFAULT_SEC, POLL_INTERVAL_MIN_SEC, POLL_INTERVAL_MAX_SEC)
  );
}

export function clampAlertRetentionDays(raw: number): number {
  return Math.round(
    clamp(
      Number(raw) || ALERT_RETENTION_DEFAULT_DAYS,
      ALERT_RETENTION_MIN_DAYS,
      ALERT_RETENTION_MAX_DAYS
    )
  );
}

export function normalizeTimeInForce(raw: string | undefined | null): TimeInForce {
  const t = String(raw || '').toLowerCase();
  if (t === 'good_till_canceled' || t === 'gtc') return 'good_till_canceled';
  if (t === 'fill_or_kill' || t === 'fok') return 'fill_or_kill';
  return 'immediate_or_cancel';
}

/** dry_run migrated away — treat as off. */
export function normalizeExecutionMode(raw: string | undefined | null): ExecutionMode {
  const m = String(raw || '').toLowerCase();
  if (m === 'live') return 'live';
  return 'off';
}

export function normalizeRiskConfig(raw: Partial<RiskConfig> | null | undefined): RiskConfig {
  const d = DEFAULT_RISK_CONFIG;
  const r = raw || {};
  const risk: RiskConfig = {
    fixed_dollars_per_trade: clamp(Number(r.fixed_dollars_per_trade ?? d.fixed_dollars_per_trade), 1, 500),
    max_dollars_per_trade: clamp(Number(r.max_dollars_per_trade ?? d.max_dollars_per_trade), 1, 500),
    min_dollars_per_trade: clamp(Number(r.min_dollars_per_trade ?? d.min_dollars_per_trade), 1, 500),
    max_open_positions: Math.round(clamp(Number(r.max_open_positions ?? d.max_open_positions), 1, 50)),
    max_trades_per_day: Math.round(
      clamp(Number(r.max_trades_per_day ?? d.max_trades_per_day), 1, 50000)
    ),
    // New field only — do not migrate old max_trades_per_asset_per_day (was 100).
    max_trades_per_asset_per_window: Math.round(
      clamp(Number(r.max_trades_per_asset_per_window ?? d.max_trades_per_asset_per_window), 1, 5)
    ),
    daily_loss_stop_usd: clamp(Number(r.daily_loss_stop_usd ?? d.daily_loss_stop_usd), 1, 10000),
    min_minutes_left: Math.round(clamp(Number(r.min_minutes_left ?? d.min_minutes_left), 0, 14)),
    min_minutes_elapsed: Math.round(
      clamp(Number(r.min_minutes_elapsed ?? d.min_minutes_elapsed), 0, 10)
    ),
    max_entry_ask_usd: clamp(Number(r.max_entry_ask_usd ?? d.max_entry_ask_usd), 0.5, 0.99),
    time_in_force: normalizeTimeInForce(r.time_in_force ?? d.time_in_force),
    manual_buy_time_in_force: normalizeTimeInForce(
      r.manual_buy_time_in_force ?? d.manual_buy_time_in_force
    ),
    chase_above_ask_usd: snap(
      clamp(Number(r.chase_above_ask_usd ?? d.chase_above_ask_usd), 0, 0.05),
      0.01
    ),
    protect_sell_enabled: Boolean(
      r.protect_sell_enabled ?? d.protect_sell_enabled
    ),
    protect_sell_gap_ratio: snap(
      clamp(Number(r.protect_sell_gap_ratio ?? d.protect_sell_gap_ratio), 0.5, 3),
      0.25
    ),
    protect_sell_grace_seconds: Math.round(
      snap(clamp(Number(r.protect_sell_grace_seconds ?? d.protect_sell_grace_seconds), 0, 120), 15)
    ),
    home_sell_at_pct: normalizeSellAtPct(r.home_sell_at_pct ?? d.home_sell_at_pct ?? 0),
    cushion_lean_sell_at_pct: normalizeSellAtPct(
      r.cushion_lean_sell_at_pct ?? d.cushion_lean_sell_at_pct ?? 0
    ),
    cushion_lean_enabled: r.cushion_lean_enabled !== false,
    cushion_lean_enter_mult: snap(
      clamp(Number(r.cushion_lean_enter_mult ?? d.cushion_lean_enter_mult ?? 1), 0.5, 1.5),
      0.05
    ),
    cushion_lean_max_gap_mult: snap(
      clamp(Number(r.cushion_lean_max_gap_mult ?? d.cushion_lean_max_gap_mult ?? 2.5), 1.5, 5),
      0.25
    ),
    smart_buy_enabled: r.smart_buy_enabled !== false,
    smart_buy_min_edge_usd: snap(
      clamp(Number(r.smart_buy_min_edge_usd ?? d.smart_buy_min_edge_usd), 0.04, 0.15),
      0.01
    ),
    cash_out_enabled: Boolean(r.cash_out_enabled ?? d.cash_out_enabled),
    cash_out_fixed_dollars_per_trade: r.cash_out_fixed_dollars_per_trade,
    cash_out_max_dollars_per_trade: r.cash_out_max_dollars_per_trade,
    cash_out_min_dollars_per_trade: r.cash_out_min_dollars_per_trade,
    cash_out_enter_pct: normalizeCashOutEnterPct(r.cash_out_enter_pct ?? d.cash_out_enter_pct),
    cash_out_max_ask_usd: normalizeCashOutMaxAsk(r.cash_out_max_ask_usd ?? d.cash_out_max_ask_usd),
    cash_out_bid_usd: normalizeCashOutBid(r.cash_out_bid_usd ?? d.cash_out_bid_usd),
    cash_out_stop_usd: normalizeCashOutStopUsd(r.cash_out_stop_usd ?? d.cash_out_stop_usd),
    cash_out_skip_thin_bid: r.cash_out_skip_thin_bid === true,
    cash_out_assets: normalizeCashOutAssets(
      r.cash_out_assets !== undefined ? r.cash_out_assets : d.cash_out_assets
    ),
    gold_fade_enabled: r.gold_fade_enabled === true,
    gold_fade_fixed_dollars_per_trade: r.gold_fade_fixed_dollars_per_trade,
    gold_fade_max_dollars_per_trade: r.gold_fade_max_dollars_per_trade,
    gold_fade_min_dollars_per_trade: r.gold_fade_min_dollars_per_trade,
    gold_fade_max_gap_usd: normalizeGoldFadeMaxGapUsd(r.gold_fade_max_gap_usd ?? d.gold_fade_max_gap_usd),
    gold_fade_max_ask_usd: normalizeGoldFadeMaxAskUsd(r.gold_fade_max_ask_usd ?? d.gold_fade_max_ask_usd),
    gold_fade_take_usd: normalizeGoldFadeTakeUsd(r.gold_fade_take_usd ?? d.gold_fade_take_usd),
    gold_fade_stop_usd: normalizeGoldFadeStopUsd(r.gold_fade_stop_usd ?? d.gold_fade_stop_usd),
    gold_fade_flatten_minutes: normalizeGoldFadeFlattenMinutes(
      r.gold_fade_flatten_minutes ?? d.gold_fade_flatten_minutes
    ),
    gold_fade_skip_thin_bid: inheritSkipThinBid(r.gold_fade_skip_thin_bid, r.cash_out_skip_thin_bid === true),
    twap_lock_enabled: r.twap_lock_enabled === true,
    twap_lock_fixed_dollars_per_trade: r.twap_lock_fixed_dollars_per_trade,
    twap_lock_max_dollars_per_trade: r.twap_lock_max_dollars_per_trade,
    twap_lock_min_dollars_per_trade: r.twap_lock_min_dollars_per_trade,
    twap_lock_assets: normalizeTwapLockAssets(
      r.twap_lock_assets !== undefined ? r.twap_lock_assets : d.twap_lock_assets
    ),
    twap_lock_max_ask_usd: normalizeTwapLockMaxAskUsd(r.twap_lock_max_ask_usd ?? d.twap_lock_max_ask_usd),
    twap_lock_skip_thin_bid: inheritSkipThinBid(r.twap_lock_skip_thin_bid, r.cash_out_skip_thin_bid === true),
    last_minute_enabled: r.last_minute_enabled === true,
    last_minute_side: normalizeLastMinuteSide(r.last_minute_side ?? d.last_minute_side),
    last_minute_max_ask_usd: normalizeLastMinuteMaxAskUsd(
      r.last_minute_max_ask_usd ?? d.last_minute_max_ask_usd
    ),
    last_minute_watch_seconds: normalizeLastMinuteWatchSeconds(
      r.last_minute_watch_seconds ?? d.last_minute_watch_seconds
    ),
    last_minute_enter_seconds: normalizeLastMinuteEnterSeconds(
      r.last_minute_enter_seconds ?? d.last_minute_enter_seconds,
      r.last_minute_watch_seconds ?? d.last_minute_watch_seconds
    ),
    last_minute_stop_seconds: normalizeLastMinuteStopSeconds(
      r.last_minute_stop_seconds ?? d.last_minute_stop_seconds,
      r.last_minute_enter_seconds ?? d.last_minute_enter_seconds
    ),
    last_minute_ladder_seconds: normalizeLastMinuteLadderSeconds(
      r.last_minute_ladder_seconds ?? d.last_minute_ladder_seconds
    ),
    last_minute_clip_count: normalizeLastMinuteClipCount(r.last_minute_clip_count ?? d.last_minute_clip_count),
    last_minute_max_clips: normalizeLastMinuteMaxClips(r.last_minute_max_clips ?? d.last_minute_max_clips),
    last_minute_both_min_ask: normalizeLastMinuteBothMinAsk(
      r.last_minute_both_min_ask ?? d.last_minute_both_min_ask,
      r.last_minute_max_ask_usd ?? d.last_minute_max_ask_usd
    ),
    last_minute_both_gap: normalizeLastMinuteBothGap(r.last_minute_both_gap ?? d.last_minute_both_gap),
    last_minute_flip_sell_usd: normalizeLastMinuteFlipSellUsd(
      r.last_minute_flip_sell_usd ?? d.last_minute_flip_sell_usd
    ),
    last_minute_atr_cushion_enabled: r.last_minute_atr_cushion_enabled !== false,
    last_minute_atr_ask_usd: normalizeLastMinuteAtrAskUsd(
      r.last_minute_atr_ask_usd ?? d.last_minute_atr_ask_usd
    ),
    last_minute_atr_mult: normalizeLastMinuteAtrMult(r.last_minute_atr_mult ?? d.last_minute_atr_mult),
    last_minute_skip_thin_bid: inheritSkipThinBid(
      r.last_minute_skip_thin_bid,
      r.cash_out_skip_thin_bid === true
    ),
    last_minute_assets: normalizeLastMinuteAssets(
      r.last_minute_assets !== undefined ? r.last_minute_assets : d.last_minute_assets
    ),
    step_buy_enabled: r.step_buy_enabled === true,
    step_buy_start_minutes: normalizeStepBuyStartMinutes(
      r.step_buy_start_minutes ?? d.step_buy_start_minutes
    ),
    step_buy_cushion_pct: normalizeStepBuyCushionPct(r.step_buy_cushion_pct ?? d.step_buy_cushion_pct),
    step_buy_add_cushion_pct: normalizeStepBuyAddCushionPct(
      r.step_buy_add_cushion_pct ?? d.step_buy_add_cushion_pct,
      r.step_buy_cushion_pct ?? d.step_buy_cushion_pct
    ),
    step_buy_sell_if_thesis_dies: normalizeStepBuySellIfThesisDies(
      r.step_buy_sell_if_thesis_dies ?? d.step_buy_sell_if_thesis_dies
    ),
    step_buy_lot_count: normalizeStepBuyLotCount(r.step_buy_lot_count ?? d.step_buy_lot_count),
    step_buy_add_wait_minutes: normalizeStepBuyAddWaitMinutes(
      r.step_buy_add_wait_minutes ?? d.step_buy_add_wait_minutes
    ),
    step_buy_add_band_usd: normalizeStepBuyAddBandUsd(r.step_buy_add_band_usd ?? d.step_buy_add_band_usd),
    step_buy_max_lots: normalizeStepBuyMaxLots(r.step_buy_max_lots ?? d.step_buy_max_lots),
    step_buy_stop_usd: normalizeStepBuyStopUsd(r.step_buy_stop_usd ?? d.step_buy_stop_usd),
    step_buy_max_ask_usd: normalizeStepBuyMaxAskUsd(r.step_buy_max_ask_usd ?? d.step_buy_max_ask_usd),
    step_buy_skip_thin_bid: inheritSkipThinBid(r.step_buy_skip_thin_bid, r.cash_out_skip_thin_bid === true),
    step_buy_assets: normalizeStepBuyAssets(r.step_buy_assets !== undefined ? r.step_buy_assets : d.step_buy_assets),
    spike_fade_enabled: r.spike_fade_enabled === true,
    spike_fade_start_minutes: normalizeSpikeFadeStartMinutes(
      r.spike_fade_start_minutes ?? d.spike_fade_start_minutes
    ),
    spike_fade_until_minutes: normalizeSpikeFadeUntilMinutes(
      r.spike_fade_until_minutes ?? d.spike_fade_until_minutes
    ),
    spike_fade_expensive_min_usd: normalizeSpikeFadeExpensiveMinUsd(
      r.spike_fade_expensive_min_usd ?? d.spike_fade_expensive_min_usd
    ),
    spike_fade_expensive_max_usd: normalizeSpikeFadeExpensiveMaxUsd(
      r.spike_fade_expensive_max_usd ?? d.spike_fade_expensive_max_usd
    ),
    spike_fade_cheap_min_usd: normalizeSpikeFadeCheapMinUsd(
      r.spike_fade_cheap_min_usd ?? d.spike_fade_cheap_min_usd
    ),
    spike_fade_cheap_max_usd: normalizeSpikeFadeCheapMaxUsd(
      r.spike_fade_cheap_max_usd ?? d.spike_fade_cheap_max_usd
    ),
    spike_fade_take_ask_usd: normalizeSpikeFadeTakeAskUsd(
      r.spike_fade_take_ask_usd ?? d.spike_fade_take_ask_usd
    ),
    spike_fade_stop_ask_usd: normalizeSpikeFadeStopAskUsd(
      r.spike_fade_stop_ask_usd ?? d.spike_fade_stop_ask_usd
    ),
    spike_fade_flatten_minutes: normalizeSpikeFadeFlattenMinutes(
      r.spike_fade_flatten_minutes ?? d.spike_fade_flatten_minutes
    ),
    spike_fade_lot_count: normalizeSpikeFadeLotCount(r.spike_fade_lot_count ?? d.spike_fade_lot_count),
    spike_fade_skip_thin_bid: inheritSkipThinBid(r.spike_fade_skip_thin_bid, r.cash_out_skip_thin_bid === true),
    spike_fade_assets: normalizeSpikeFadeAssets(
      r.spike_fade_assets !== undefined ? r.spike_fade_assets : d.spike_fade_assets
    ),
    pair_lock_enabled: r.pair_lock_enabled === true,
    pair_lock_start_minutes: normalizePairLockStartMinutes(
      r.pair_lock_start_minutes ?? d.pair_lock_start_minutes
    ),
    pair_lock_until_minutes: normalizePairLockUntilMinutes(
      r.pair_lock_until_minutes ?? d.pair_lock_until_minutes
    ),
    pair_lock_runner_max_ask_usd: normalizePairLockRunnerMaxAskUsd(
      r.pair_lock_runner_max_ask_usd ?? d.pair_lock_runner_max_ask_usd
    ),
    pair_lock_min_lock_usd: normalizePairLockMinLockUsd(
      r.pair_lock_min_lock_usd ?? d.pair_lock_min_lock_usd
    ),
    pair_lock_flatten_minutes: normalizePairLockFlattenMinutes(
      r.pair_lock_flatten_minutes ?? d.pair_lock_flatten_minutes
    ),
    pair_lock_runner_stop_usd: normalizePairLockRunnerStopUsd(
      r.pair_lock_runner_stop_usd ?? d.pair_lock_runner_stop_usd
    ),
    pair_lock_lot_count: normalizePairLockLotCount(r.pair_lock_lot_count ?? d.pair_lock_lot_count),
    pair_lock_add_pairs: normalizePairLockAddPairs(r.pair_lock_add_pairs ?? d.pair_lock_add_pairs),
    pair_lock_lock_first: r.pair_lock_lock_first !== false,
    pair_lock_recover_seconds: normalizePairLockRecoverSeconds(
      r.pair_lock_recover_seconds ?? d.pair_lock_recover_seconds
    ),
    pair_lock_skip_thin_bid: inheritSkipThinBid(r.pair_lock_skip_thin_bid, r.cash_out_skip_thin_bid === true),
    pair_lock_assets: normalizePairLockAssets(
      r.pair_lock_assets !== undefined ? r.pair_lock_assets : d.pair_lock_assets
    ),
    cap_lock_enabled: r.cap_lock_enabled === true,
    cap_lock_max_loss_usd: normalizeCapLockMaxLossUsd(
      r.cap_lock_max_loss_usd ?? d.cap_lock_max_loss_usd
    ),
    cap_lock_window_open_seconds: normalizeCapLockWindowOpenSeconds(
      r.cap_lock_window_open_seconds ?? d.cap_lock_window_open_seconds
    ),
    cap_lock_allow_later: isCapLockAllowLater(r.cap_lock_allow_later),
    cap_lock_lot_count: normalizeCapLockLotCount(r.cap_lock_lot_count ?? d.cap_lock_lot_count),
    cap_lock_assets: normalizeCapLockAssets(
      r.cap_lock_assets !== undefined ? r.cap_lock_assets : d.cap_lock_assets
    ),
    buffer_run_enabled: r.buffer_run_enabled === true,
    buffer_run_ask_min_usd: normalizeBufferRunAskMinUsd(
      r.buffer_run_ask_min_usd ?? d.buffer_run_ask_min_usd
    ),
    buffer_run_ask_max_usd: normalizeBufferRunAskMaxUsd(
      r.buffer_run_ask_max_usd ?? d.buffer_run_ask_max_usd
    ),
    buffer_run_take_usd: normalizeBufferRunTakeUsd(r.buffer_run_take_usd ?? d.buffer_run_take_usd),
    buffer_run_stop_usd: normalizeBufferRunStopUsd(r.buffer_run_stop_usd ?? d.buffer_run_stop_usd),
    buffer_run_enter_elapsed_minutes: normalizeBufferRunEnterElapsedMinutes(
      r.buffer_run_enter_elapsed_minutes ?? d.buffer_run_enter_elapsed_minutes
    ),
    buffer_run_enter_left_minutes: normalizeBufferRunEnterLeftMinutes(
      r.buffer_run_enter_left_minutes ?? d.buffer_run_enter_left_minutes
    ),
    buffer_run_flatten_minutes: normalizeBufferRunFlattenMinutes(
      r.buffer_run_flatten_minutes ?? d.buffer_run_flatten_minutes
    ),
    buffer_run_atr_mult: normalizeBufferRunAtrMult(r.buffer_run_atr_mult ?? d.buffer_run_atr_mult),
    buffer_run_min_gap_btc_usd: normalizeBufferRunMinGapBtcUsd(
      r.buffer_run_min_gap_btc_usd ?? d.buffer_run_min_gap_btc_usd
    ),
    buffer_run_min_gap_eth_usd: normalizeBufferRunMinGapEthUsd(
      r.buffer_run_min_gap_eth_usd ?? d.buffer_run_min_gap_eth_usd
    ),
    buffer_run_fixed_dollars_per_trade: normalizeBufferRunDollars(
      r.buffer_run_fixed_dollars_per_trade ?? d.buffer_run_fixed_dollars_per_trade
    ),
    buffer_run_pair_sum_skip: normalizeBufferRunPairSumSkip(
      r.buffer_run_pair_sum_skip ?? d.buffer_run_pair_sum_skip
    ),
    buffer_run_skip_thin_bid: r.buffer_run_skip_thin_bid === true,
    buffer_run_assets: normalizeBufferRunAssets(
      r.buffer_run_assets !== undefined ? r.buffer_run_assets : d.buffer_run_assets
    ),
    cheap_loop_enabled: r.cheap_loop_enabled === true,
    cheap_loop_start_minutes: normalizeCheapLoopStartMinutes(
      r.cheap_loop_start_minutes ?? d.cheap_loop_start_minutes
    ),
    cheap_loop_flatten_minutes: normalizeCheapLoopFlattenMinutes(
      r.cheap_loop_flatten_minutes ?? d.cheap_loop_flatten_minutes
    ),
    cheap_loop_cheap_max_ask_usd: normalizeCheapLoopCheapMaxAskUsd(
      r.cheap_loop_cheap_max_ask_usd ?? d.cheap_loop_cheap_max_ask_usd
    ),
    cheap_loop_min_gap_usd: normalizeCheapLoopMinGapUsd(
      r.cheap_loop_min_gap_usd ?? d.cheap_loop_min_gap_usd
    ),
    cheap_loop_min_live_cushion_pct: normalizeCheapLoopMinLiveCushionPct(
      r.cheap_loop_min_live_cushion_pct ?? d.cheap_loop_min_live_cushion_pct
    ),
    cheap_loop_take_usd: normalizeCheapLoopTakeUsd(r.cheap_loop_take_usd ?? d.cheap_loop_take_usd),
    cheap_loop_stop_enabled: r.cheap_loop_stop_enabled === true,
    cheap_loop_stop_usd: normalizeCheapLoopStopUsd(r.cheap_loop_stop_usd ?? d.cheap_loop_stop_usd),
    cheap_loop_min_hold_minutes: normalizeCheapLoopMinHoldMinutes(
      r.cheap_loop_min_hold_minutes ?? d.cheap_loop_min_hold_minutes
    ),
    cheap_loop_cooldown_minutes: normalizeCheapLoopCooldownMinutes(
      r.cheap_loop_cooldown_minutes ?? d.cheap_loop_cooldown_minutes
    ),
    cheap_loop_cycles: normalizeCheapLoopCycles(r.cheap_loop_cycles ?? d.cheap_loop_cycles),
    cheap_loop_lot_count: normalizeCheapLoopLotCount(r.cheap_loop_lot_count ?? d.cheap_loop_lot_count),
    cheap_loop_skip_thin_bid: r.cheap_loop_skip_thin_bid === true,
    cheap_loop_assets: normalizeCheapLoopAssets(
      r.cheap_loop_assets !== undefined ? r.cheap_loop_assets : d.cheap_loop_assets
    ),
    cheap_loop_hourly_enabled: r.cheap_loop_hourly_enabled === true,
    cheap_loop_hourly_start_minutes: normalizeCheapLoopHourlyStartMinutes(
      r.cheap_loop_hourly_start_minutes ?? d.cheap_loop_hourly_start_minutes
    ),
    cheap_loop_hourly_flatten_minutes: normalizeCheapLoopFlattenMinutes(
      r.cheap_loop_hourly_flatten_minutes ?? d.cheap_loop_hourly_flatten_minutes
    ),
    cheap_loop_hourly_cheap_max_ask_usd: normalizeCheapLoopCheapMaxAskUsd(
      r.cheap_loop_hourly_cheap_max_ask_usd ?? d.cheap_loop_hourly_cheap_max_ask_usd
    ),
    cheap_loop_hourly_min_gap_usd: normalizeCheapLoopMinGapUsd(
      r.cheap_loop_hourly_min_gap_usd ?? d.cheap_loop_hourly_min_gap_usd
    ),
    cheap_loop_hourly_take_usd: normalizeCheapLoopTakeUsd(
      r.cheap_loop_hourly_take_usd ?? d.cheap_loop_hourly_take_usd
    ),
    cheap_loop_hourly_stop_enabled: r.cheap_loop_hourly_stop_enabled === true,
    cheap_loop_hourly_stop_usd: normalizeCheapLoopStopUsd(
      r.cheap_loop_hourly_stop_usd ?? d.cheap_loop_hourly_stop_usd
    ),
    cheap_loop_hourly_min_hold_minutes: normalizeCheapLoopHourlyMinHoldMinutes(
      r.cheap_loop_hourly_min_hold_minutes ?? d.cheap_loop_hourly_min_hold_minutes
    ),
    cheap_loop_hourly_cooldown_minutes: normalizeCheapLoopHourlyCooldownMinutes(
      r.cheap_loop_hourly_cooldown_minutes ?? d.cheap_loop_hourly_cooldown_minutes
    ),
    cheap_loop_hourly_cycles: normalizeCheapLoopHourlyCycles(
      r.cheap_loop_hourly_cycles ?? d.cheap_loop_hourly_cycles
    ),
    cheap_loop_hourly_lot_count: normalizeCheapLoopLotCount(
      r.cheap_loop_hourly_lot_count ?? d.cheap_loop_hourly_lot_count
    ),
    cheap_loop_hourly_skip_thin_bid: r.cheap_loop_hourly_skip_thin_bid === true,
    cheap_loop_hourly_assets: normalizeCheapLoopHourlyAssets(
      r.cheap_loop_hourly_assets !== undefined ? r.cheap_loop_hourly_assets : d.cheap_loop_hourly_assets
    ),
    cheap_loop_weekly_enabled: r.cheap_loop_weekly_enabled === true,
    cheap_loop_weekly_start_minutes: normalizeCheapLoopHourlyStartMinutes(
      r.cheap_loop_weekly_start_minutes ?? d.cheap_loop_weekly_start_minutes
    ),
    cheap_loop_weekly_flatten_minutes: normalizeCheapLoopWeeklyFlattenMinutes(
      r.cheap_loop_weekly_flatten_minutes ?? d.cheap_loop_weekly_flatten_minutes
    ),
    cheap_loop_weekly_cheap_max_ask_usd: normalizeCheapLoopCheapMaxAskUsd(
      r.cheap_loop_weekly_cheap_max_ask_usd ?? d.cheap_loop_weekly_cheap_max_ask_usd
    ),
    cheap_loop_weekly_min_gap_usd: normalizeCheapLoopMinGapUsd(
      r.cheap_loop_weekly_min_gap_usd ?? d.cheap_loop_weekly_min_gap_usd
    ),
    cheap_loop_weekly_take_usd: normalizeCheapLoopTakeUsd(
      r.cheap_loop_weekly_take_usd ?? d.cheap_loop_weekly_take_usd
    ),
    cheap_loop_weekly_stop_enabled: (r.cheap_loop_weekly_stop_enabled ?? d.cheap_loop_weekly_stop_enabled) === true,
    cheap_loop_weekly_stop_usd: normalizeCheapLoopStopUsd(
      r.cheap_loop_weekly_stop_usd ?? d.cheap_loop_weekly_stop_usd
    ),
    cheap_loop_weekly_min_hold_minutes: normalizeCheapLoopHourlyMinHoldMinutes(
      r.cheap_loop_weekly_min_hold_minutes ?? d.cheap_loop_weekly_min_hold_minutes
    ),
    cheap_loop_weekly_cooldown_minutes: normalizeCheapLoopHourlyCooldownMinutes(
      r.cheap_loop_weekly_cooldown_minutes ?? d.cheap_loop_weekly_cooldown_minutes
    ),
    cheap_loop_weekly_cycles: normalizeCheapLoopWeeklyCycles(
      r.cheap_loop_weekly_cycles ?? d.cheap_loop_weekly_cycles
    ),
    cheap_loop_weekly_lot_count: normalizeCheapLoopLotCount(
      r.cheap_loop_weekly_lot_count ?? d.cheap_loop_weekly_lot_count
    ),
    cheap_loop_weekly_skip_thin_bid: r.cheap_loop_weekly_skip_thin_bid === true,
    cheap_loop_weekly_assets: normalizeCheapLoopWeeklyAssets(
      r.cheap_loop_weekly_assets !== undefined ? r.cheap_loop_weekly_assets : d.cheap_loop_weekly_assets
    ),
  };
  const targets = reconcileCashOutTargets(
    Number(risk.cash_out_max_ask_usd),
    Number(risk.cash_out_bid_usd)
  );
  risk.cash_out_max_ask_usd = targets.maxAsk;
  risk.cash_out_bid_usd = targets.bid;
  const spikeBands = reconcileSpikeFadeBands({
    expensiveMin: Number(risk.spike_fade_expensive_min_usd),
    expensiveMax: Number(risk.spike_fade_expensive_max_usd),
    cheapMin: Number(risk.spike_fade_cheap_min_usd),
    cheapMax: Number(risk.spike_fade_cheap_max_usd),
  });
  risk.spike_fade_expensive_min_usd = spikeBands.expensiveMin;
  risk.spike_fade_expensive_max_usd = spikeBands.expensiveMax;
  risk.spike_fade_cheap_min_usd = spikeBands.cheapMin;
  risk.spike_fade_cheap_max_usd = spikeBands.cheapMax;
  if (Number(risk.spike_fade_until_minutes) < Number(risk.spike_fade_start_minutes)) {
    risk.spike_fade_until_minutes = Number(risk.spike_fade_start_minutes);
  }
  const pairWin = reconcilePairLockWindow({
    startMinutes: risk.pair_lock_start_minutes,
    untilMinutes: risk.pair_lock_until_minutes,
  });
  risk.pair_lock_start_minutes = pairWin.startMinutes;
  risk.pair_lock_until_minutes = pairWin.untilMinutes;
  const cheap15 = reconcileCheapLoopTakeStop({
    takeUsd: risk.cheap_loop_take_usd,
    stopUsd: risk.cheap_loop_stop_usd,
    stopEnabled: risk.cheap_loop_stop_enabled,
  });
  risk.cheap_loop_take_usd = cheap15.takeUsd;
  risk.cheap_loop_stop_usd = cheap15.stopUsd;
  const cheapHourly = reconcileCheapLoopTakeStop({
    takeUsd: risk.cheap_loop_hourly_take_usd,
    stopUsd: risk.cheap_loop_hourly_stop_usd,
    stopEnabled: risk.cheap_loop_hourly_stop_enabled,
  });
  risk.cheap_loop_hourly_take_usd = cheapHourly.takeUsd;
  risk.cheap_loop_hourly_stop_usd = cheapHourly.stopUsd;
  const cheapWeekly = reconcileCheapLoopTakeStop({
    takeUsd: risk.cheap_loop_weekly_take_usd,
    stopUsd: risk.cheap_loop_weekly_stop_usd,
    stopEnabled: risk.cheap_loop_weekly_stop_enabled,
  });
  risk.cheap_loop_weekly_take_usd = cheapWeekly.takeUsd;
  risk.cheap_loop_weekly_stop_usd = cheapWeekly.stopUsd;
  const bufferAsk = reconcileBufferRunAskBand({
    askMinUsd: risk.buffer_run_ask_min_usd,
    askMaxUsd: risk.buffer_run_ask_max_usd,
  });
  risk.buffer_run_ask_min_usd = bufferAsk.askMinUsd;
  risk.buffer_run_ask_max_usd = bufferAsk.askMaxUsd;
  const bufferTakeStop = reconcileBufferRunTakeStop({
    takeUsd: risk.buffer_run_take_usd,
    stopUsd: risk.buffer_run_stop_usd,
  });
  risk.buffer_run_take_usd = bufferTakeStop.takeUsd;
  risk.buffer_run_stop_usd = bufferTakeStop.stopUsd;
  const bufferTiming = reconcileBufferRunTiming({
    enterElapsedMinutes: risk.buffer_run_enter_elapsed_minutes,
    enterLeftMinutes: risk.buffer_run_enter_left_minutes,
    flattenMinutes: risk.buffer_run_flatten_minutes,
  });
  risk.buffer_run_enter_elapsed_minutes = bufferTiming.enterElapsedMinutes;
  risk.buffer_run_enter_left_minutes = bufferTiming.enterLeftMinutes;
  risk.buffer_run_flatten_minutes = bufferTiming.flattenMinutes;
  if (risk.fixed_dollars_per_trade > risk.max_dollars_per_trade) {
    risk.fixed_dollars_per_trade = risk.max_dollars_per_trade;
  }
  if (risk.min_dollars_per_trade > risk.max_dollars_per_trade) {
    risk.min_dollars_per_trade = risk.max_dollars_per_trade;
  }
  const cashDollars = cashOutTradeDollars(risk);
  risk.cash_out_fixed_dollars_per_trade = cashDollars.fixed;
  risk.cash_out_max_dollars_per_trade = cashDollars.max;
  risk.cash_out_min_dollars_per_trade = cashDollars.min;
  const fadeDollars = goldFadeTradeDollars(risk);
  risk.gold_fade_fixed_dollars_per_trade = fadeDollars.fixed;
  risk.gold_fade_max_dollars_per_trade = fadeDollars.max;
  risk.gold_fade_min_dollars_per_trade = fadeDollars.min;
  const twapDollars = twapLockTradeDollars(risk);
  risk.twap_lock_fixed_dollars_per_trade = twapDollars.fixed;
  risk.twap_lock_max_dollars_per_trade = twapDollars.max;
  risk.twap_lock_min_dollars_per_trade = twapDollars.min;
  return risk;
}

/** Immutable normalize — never mutates input. */
export function normalizeAppConfig(raw: Partial<AppConfig> | null | undefined): AppConfig {
  const d = defaultAppConfig();
  if (!raw) return d;

  const cushions = { ...DEFAULT_CUSHIONS };
  for (const asset of Object.keys(DEFAULT_CUSHIONS) as AssetKey[]) {
    const v = Number((raw.cushions as any)?.[asset] ?? DEFAULT_CUSHIONS[asset]);
    cushions[asset] = clampCushion(asset, v);
  }

  const assets_enabled = { ...d.assets_enabled };
  for (const asset of Object.keys(assets_enabled) as AssetKey[]) {
    const v = (raw.assets_enabled as any)?.[asset];
    if (typeof v === 'boolean') assets_enabled[asset] = v;
  }

  const risk = normalizeRiskConfig(raw.risk);
  const manual_risk = normalizeManualPathRisk(raw.manual_risk, risk);
  risk.manual_buy_time_in_force = manual_risk.time_in_force;

  const alert_prefs = { ...d.alert_prefs };
  if (raw.alert_prefs) {
    for (const k of Object.keys(alert_prefs) as (keyof typeof alert_prefs)[]) {
      const p = (raw.alert_prefs as any)[k];
      if (p && typeof p === 'object') {
        alert_prefs[k] = {
          enabled: p.enabled !== false,
          push: p.push !== false,
        };
      }
    }
  }

  const legacyDry = String(raw.execution_mode || '').toLowerCase() === 'dry_run';
  let auto_trade_enabled = Boolean(raw.auto_trade_enabled);
  if (legacyDry) auto_trade_enabled = false;

  return {
    version: 1,
    alerts_enabled: raw.alerts_enabled !== false,
    auto_trade_enabled,
    execution_mode: auto_trade_enabled ? 'live' : 'off',
    live_armed: auto_trade_enabled,
    poll_interval_seconds: clampPollIntervalSeconds(
      Number((raw as any).poll_interval_seconds ?? d.poll_interval_seconds)
    ),
    alert_retention_days: clampAlertRetentionDays(
      Number((raw as any).alert_retention_days ?? d.alert_retention_days)
    ),
    cushions,
    assets_enabled,
    risk,
    manual_risk,
    alert_prefs,
  };
}

export function snapshotConfig(cfg: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(cfg)) as AppConfig;
}

export function configForHomeBuy(cfg: AppConfig): AppConfig {
  return mergeHomeBuyRisk(cfg) as AppConfig;
}

export { normalizeManualPathRisk };
export type { ManualPathRisk };

/** Trading sounds come from GCP only — phone must not ding the same event. */
export function isCloudOwnedAlertSound(kind: string): boolean {
  return (
    kind === 'lean_signal' ||
    kind === 'order_filled' ||
    kind === 'protect_sell' ||
    kind === 'trade_result' ||
    kind === 'ioc_miss' ||
    kind === 'daily_loss_stop'
  );
}

export function shouldPushAlert(cfg: AppConfig, kind: keyof AppConfig['alert_prefs']): boolean {
  if (!cfg.alerts_enabled) return false;
  if (isCloudOwnedAlertSound(kind)) return false;
  const pref = cfg.alert_prefs[kind];
  if (!pref || !pref.enabled || !pref.push) return false;
  return true;
}
