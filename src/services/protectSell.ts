import type { LeanResult } from './lean/lean';
import type { TradeRecord, TradeSide } from '../storage/repos';
import { inferFillCount } from './settlement';
import {
  buildProtectSellOrder,
  computeProtectSellPnlUsd,
  inProtectSellGrace,
  protectSellMinGapUsd,
  shouldProtectSell as shouldProtectSellCore,
} from '../../packages/trading-core/src/protectSell';

export {
  buildProtectSellOrder,
  computeProtectSellPnlUsd,
  inProtectSellGrace,
  protectSellMinGapUsd,
};

/**
 * Sell early when the live lean flips against a held position with enough gap.
 * Example: you bought YES; lean is now NO with gap ≥ cushion × ratio → protect sell.
 */
export function shouldProtectSell(opts: {
  enabled: boolean;
  heldSide: TradeSide;
  lean: Pick<LeanResult, 'decision' | 'abs_gap' | 'phase'>;
  cushion: number;
  gapRatio: number;
  filledAt?: string | Date | number | null;
  graceSeconds?: number;
  now?: Date;
}): { sell: boolean; reason: string; minGap: number; leanGap: number } {
  return shouldProtectSellCore(opts);
}

export function pendingTradesForMarket(
  trades: TradeRecord[],
  marketTicker: string
): TradeRecord[] {
  return trades.filter(
    (t) =>
      !t.dry_run &&
      t.outcome === 'pending' &&
      t.market_ticker === marketTicker &&
      inferFillCount(t) > 0
  );
}
