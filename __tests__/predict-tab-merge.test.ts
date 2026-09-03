import { mergePredictTabConfig } from '../src/services/predictTabMerge';

describe('mergePredictTabConfig', () => {
  test('maps desktop live + enabled → foresight live auto-trade', () => {
    const cfg = mergePredictTabConfig(
      { gold_cushion_usd: 7, oil_cushion_usd: 0.3, btc_cushion_usd: 175 },
      {
        kalshi_trade_enabled: true,
        execution_mode: 'live',
        fixed_dollars_per_trade: 5,
        max_dollars_per_trade: 5,
        daily_loss_stop_usd: 50,
        max_open_positions: 5,
        max_entry_ask_usd: 0.9,
        min_minutes_left: 2,
        trade_wti: false,
        trade_gold: false,
        trade_silver: false,
        trade_btc: false,
        trade_eth: false,
      }
    );
    expect(cfg.execution_mode).toBe('live');
    expect(cfg.auto_trade_enabled).toBe(true);
    expect(cfg.cushions.Gold).toBe(7);
    expect(cfg.risk.max_entry_ask_usd).toBe(0.9);
    expect(cfg.assets_enabled.Gold).toBe(true);
  });

  test('maps desktop dry_run → auto-trade off', () => {
    const cfg = mergePredictTabConfig(
      {},
      { kalshi_trade_enabled: true, execution_mode: 'dry_run' }
    );
    expect(cfg.auto_trade_enabled).toBe(false);
    expect(cfg.execution_mode).toBe('off');
  });
});
