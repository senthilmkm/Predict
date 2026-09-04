"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_ALERT_KINDS = exports.DEFAULT_CUSHIONS = exports.POLL_INTERVAL_MAX_SEC = exports.POLL_INTERVAL_DEFAULT_SEC = exports.POLL_INTERVAL_MIN_SEC = void 0;
exports.defaultAlertPrefs = defaultAlertPrefs;
exports.defaultAppConfig = defaultAppConfig;
exports.POLL_INTERVAL_MIN_SEC = 10;
exports.POLL_INTERVAL_DEFAULT_SEC = 20;
exports.POLL_INTERVAL_MAX_SEC = 120;
exports.DEFAULT_CUSHIONS = {
    WTI: 0.3,
    Gold: 7,
    Silver: 0.23,
    BTC: 175,
    ETH: 9,
};
exports.ALL_ALERT_KINDS = [
    'lean_signal',
    'order_placed',
    'order_filled',
    'ioc_miss',
    'trade_result',
    'protect_sell',
    'daily_loss_stop',
    'error',
];
function defaultAlertPrefs() {
    const prefs = {};
    for (const k of exports.ALL_ALERT_KINDS) {
        prefs[k] = { enabled: true, push: true };
    }
    return prefs;
}
function defaultAppConfig() {
    return {
        version: 1,
        alerts_enabled: true,
        auto_trade_enabled: false,
        execution_mode: 'off',
        live_armed: false,
        poll_interval_seconds: exports.POLL_INTERVAL_DEFAULT_SEC,
        alert_retention_days: 30,
        cushions: { ...exports.DEFAULT_CUSHIONS },
        assets_enabled: {
            WTI: true,
            Gold: true,
            Silver: true,
            BTC: true,
            ETH: true,
        },
        risk: {
            fixed_dollars_per_trade: 5,
            max_dollars_per_trade: 5,
            min_dollars_per_trade: 1,
            max_open_positions: 5,
            max_trades_per_day: 100,
            max_trades_per_asset_per_day: 100,
            daily_loss_stop_usd: 50,
            min_minutes_left: 2,
            min_minutes_elapsed: 2,
            max_entry_ask_usd: 0.9,
            time_in_force: 'immediate_or_cancel',
            chase_above_ask_usd: 0.02,
            protect_sell_enabled: false,
            protect_sell_gap_ratio: 1,
            protect_sell_grace_seconds: 45,
        },
        alert_prefs: defaultAlertPrefs(),
    };
}
