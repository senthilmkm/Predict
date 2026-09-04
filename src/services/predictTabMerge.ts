import { AppConfig, defaultAppConfig } from '../config/types';
import { normalizeAppConfig } from '../config/normalize';
import { KalshiCredentials } from './credentials';

export interface PredictPublicConfig {
  oil_cushion_usd?: number;
  gold_cushion_usd?: number;
  silver_cushion_usd?: number;
  btc_cushion_usd?: number;
  eth_cushion_usd?: number;
}

export interface KalshiPublicConfig {
  kalshi_trade_enabled?: boolean;
  execution_mode?: string;
  fixed_dollars_per_trade?: number;
  max_dollars_per_trade?: number;
  min_dollars_per_trade?: number;
  daily_loss_stop_usd?: number;
  max_open_positions?: number;
  max_trades_per_day?: number;
  max_trades_per_asset_per_day?: number;
  trade_wti?: boolean;
  trade_gold?: boolean;
  trade_silver?: boolean;
  trade_btc?: boolean;
  trade_eth?: boolean;
  oil_cushion_usd?: number;
  gold_cushion_usd?: number;
  silver_cushion_usd?: number;
  btc_cushion_usd?: number;
  eth_cushion_usd?: number;
  max_entry_ask_usd?: number;
  min_minutes_left?: number;
  min_minutes_elapsed?: number;
  time_in_force?: string;
  price_improvement_usd?: number;
}

/** Merge desktop public configs into Predict AppConfig (no secrets). Legacy dry_run → off. */
export function mergePredictTabConfig(
  predict: PredictPublicConfig = {},
  kalshi: KalshiPublicConfig = {}
): AppConfig {
  const base = defaultAppConfig();
  const tradeEnabled = Boolean(kalshi.kalshi_trade_enabled);
  const execRaw = String(kalshi.execution_mode || 'off').toLowerCase();
  const live = tradeEnabled && execRaw === 'live';

  const assets = {
    WTI: kalshi.trade_wti !== undefined ? Boolean(kalshi.trade_wti) : true,
    Gold: kalshi.trade_gold !== undefined ? Boolean(kalshi.trade_gold) : true,
    Silver: kalshi.trade_silver !== undefined ? Boolean(kalshi.trade_silver) : true,
    BTC: kalshi.trade_btc !== undefined ? Boolean(kalshi.trade_btc) : true,
    ETH: kalshi.trade_eth !== undefined ? Boolean(kalshi.trade_eth) : true,
  };
  if (!Object.values(assets).some(Boolean)) {
    assets.WTI = assets.Gold = assets.Silver = assets.BTC = assets.ETH = true;
  }

  return normalizeAppConfig({
    ...base,
    auto_trade_enabled: live,
    execution_mode: live ? 'live' : 'off',
    cushions: {
      WTI: Number(predict.oil_cushion_usd ?? kalshi.oil_cushion_usd ?? base.cushions.WTI),
      Gold: Number(predict.gold_cushion_usd ?? kalshi.gold_cushion_usd ?? base.cushions.Gold),
      Silver: Number(
        predict.silver_cushion_usd ?? kalshi.silver_cushion_usd ?? base.cushions.Silver
      ),
      BTC: Number(predict.btc_cushion_usd ?? kalshi.btc_cushion_usd ?? base.cushions.BTC),
      ETH: Number(predict.eth_cushion_usd ?? kalshi.eth_cushion_usd ?? base.cushions.ETH),
    },
    assets_enabled: assets,
    risk: {
      ...base.risk,
      fixed_dollars_per_trade: Number(
        kalshi.fixed_dollars_per_trade ?? base.risk.fixed_dollars_per_trade
      ),
      max_dollars_per_trade: Number(
        kalshi.max_dollars_per_trade ?? base.risk.max_dollars_per_trade
      ),
      min_dollars_per_trade: Number(
        kalshi.min_dollars_per_trade ?? base.risk.min_dollars_per_trade
      ),
      daily_loss_stop_usd: Number(kalshi.daily_loss_stop_usd ?? base.risk.daily_loss_stop_usd),
      max_open_positions: Number(kalshi.max_open_positions ?? base.risk.max_open_positions),
      max_trades_per_day: Number(kalshi.max_trades_per_day ?? base.risk.max_trades_per_day),
      max_trades_per_asset_per_day: Number(
        kalshi.max_trades_per_asset_per_day ?? base.risk.max_trades_per_asset_per_day
      ),
      max_entry_ask_usd: Number(kalshi.max_entry_ask_usd ?? base.risk.max_entry_ask_usd),
      min_minutes_left: Number(kalshi.min_minutes_left ?? base.risk.min_minutes_left),
      min_minutes_elapsed: Number(
        kalshi.min_minutes_elapsed ?? base.risk.min_minutes_elapsed
      ),
      time_in_force: (kalshi.time_in_force as any) ?? base.risk.time_in_force,
      chase_above_ask_usd: Number(
        kalshi.price_improvement_usd ?? base.risk.chase_above_ask_usd
      ),
    },
  });
}

export function credentialsFromEnvParts(
  keyId: string,
  pem: string,
  apiEnv: string
): KalshiCredentials {
  return {
    keyId: keyId.trim(),
    privateKeyPem: pem.trim(),
    env: apiEnv.toLowerCase() === 'demo' ? 'demo' : 'production',
  };
}
