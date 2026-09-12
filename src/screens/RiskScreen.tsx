import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { AssetRegistry, ManualPathRisk, RiskConfig, TimeInForce } from '../config/types';
import {
  CASH_OUT_RISK_FIELD_KEYS,
  GOLD_FADE_RISK_FIELD_KEYS,
  LAST_MINUTE_RISK_FIELD_KEYS,
  PATH_RISK_FIELD_KEYS,
  TWAP_LOCK_RISK_FIELD_KEYS,
  PROTECT_RISK_FIELD_KEYS,
  RISK_FIELD_META,
  SHARED_RISK_FIELD_KEYS,
  SMART_BUY_RISK_FIELD_KEYS,
  TIME_IN_FORCE_OPTIONS,
} from '../config/riskDefaults';
import { useConfigStore } from '../state/configStore';
import { useRuntimeStore } from '../state/runtimeStore';
import { cashOutEdgeWarn, normalizeCashOutAssets } from '../../packages/trading-core/src/cashOut';
import { normalizeTwapLockAssets, TWAP_LOCK_ASSETS } from '../../packages/trading-core/src/twapLock';
import {
  LastMinuteSide,
  normalizeLastMinuteSide,
} from '../../packages/trading-core/src/lastMinute';
import { PathInfoIcon } from '../components/PathInfoIcon';
import { PATH_INFO } from '../content/pathInfo';

type TabId = 'home' | 'auto';

function metaFor(keys: (keyof RiskConfig)[]) {
  return RISK_FIELD_META.filter((m) => keys.includes(m.key));
}

export function RiskScreen() {
  const config = useConfigStore((s) => s.config);
  const setRiskField = useConfigStore((s) => s.setRiskField);
  const setManualRiskField = useConfigStore((s) => s.setManualRiskField);
  const restoreSharedRiskLimits = useConfigStore((s) => s.restoreSharedRiskLimits);
  const restoreAutoRiskTab = useConfigStore((s) => s.restoreAutoRiskTab);
  const restoreHomeBuyRiskTab = useConfigStore((s) => s.restoreHomeBuyRiskTab);
  const cashOutFeatureOn = useRuntimeStore((s) => s.cashOutFeatureOn);
  const goldFadeFeatureOn = useRuntimeStore((s) => s.goldFadeFeatureOn);
  const twapLockFeatureOn = useRuntimeStore((s) => s.twapLockFeatureOn);
  const lastMinuteFeatureOn = useRuntimeStore((s) => s.lastMinuteFeatureOn);
  const [tab, setTab] = useState<TabId>('home');
  const [busy, setBusy] = useState(false);

  async function restoreShared() {
    if (busy) return;
    setBusy(true);
    try {
      await restoreSharedRiskLimits();
    } catch (e: any) {
      Alert.alert('Could not restore', String(e?.message || e || 'Restore failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function restoreTab() {
    if (busy) return;
    setBusy(true);
    try {
      if (tab === 'home') await restoreHomeBuyRiskTab();
      else await restoreAutoRiskTab();
    } catch (e: any) {
      Alert.alert('Could not restore', String(e?.message || e || 'Restore failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="screen-risk">
      <Text style={styles.lead}>
        Shared limits apply to Home Buy and Auto-trade. Each tab has its own size and timing.
      </Text>

      <View style={styles.titleRow}>
        <Text style={[styles.groupTitle, { marginBottom: 0 }]}>Shared limits</Text>
        <PathInfoIcon title={PATH_INFO.shared.title} body={PATH_INFO.shared.body} testID="path-info-shared" />
      </View>
      <Text style={styles.hint}>One Kalshi account. These stop both paths.</Text>
      {metaFor(SHARED_RISK_FIELD_KEYS).map((meta) => (
        <RiskStepper
          key={meta.key}
          meta={meta}
          value={config.risk[meta.key]}
          testPrefix="shared"
          onChange={(next) => setRiskField(meta.key, next as never)}
        />
      ))}
      <Pressable
        testID="btn-restore-shared-risk"
        style={[styles.restoreBtn, busy && styles.restoreOff]}
        onPress={() => void restoreShared()}
        disabled={busy}
      >
        <Text style={styles.restoreText}>Restore shared limits</Text>
      </Pressable>

      <View style={styles.tabRow} testID="risk-tabs">
        <Pressable
          testID="risk-tab-home"
          style={[styles.tab, tab === 'home' && styles.tabOn]}
          onPress={() => setTab('home')}
        >
          <Text style={[styles.tabText, tab === 'home' && styles.tabTextOn]}>Home Buy</Text>
        </Pressable>
        <Pressable
          testID="risk-tab-auto"
          style={[styles.tab, tab === 'auto' && styles.tabOn]}
          onPress={() => setTab('auto')}
        >
          <Text style={[styles.tabText, tab === 'auto' && styles.tabTextOn]}>Auto-trade</Text>
        </Pressable>
      </View>

      {tab === 'home' ? (
        <>
          <View style={styles.titleRow}>
            <Text style={[styles.groupTitle, { marginBottom: 0 }]}>Home Buy</Text>
            <PathInfoIcon title={PATH_INFO.home.title} body={PATH_INFO.home.body} testID="path-info-home" />
          </View>
          <Text style={styles.hint} testID="risk-home-hint">
            Used only when you tap Buy on Home. Sell stays IOC. Last signals shows a skip from this
            tab, not from Auto-trade.
          </Text>
          <PathFields
            values={config.manual_risk}
            testPrefix="home"
            onChange={(key, value) => setManualRiskField(key, value)}
          />
        </>
      ) : (
        <>
          <View style={styles.titleRow}>
            <Text style={[styles.groupTitle, { marginBottom: 0 }]}>Auto-trade</Text>
            <PathInfoIcon title={PATH_INFO.auto.title} body={PATH_INFO.auto.body} testID="path-info-auto" />
          </View>
          <Text style={styles.hint} testID="risk-auto-hint">
            Used only when Auto-trade is On. Smart buy is Auto-only. Protect money can still exit a
            Home Buy fill. Cash out, Gold fade, TWAP lock, and Last-minute are separate paths.
          </Text>
          <PathFields
            values={{
              fixed_dollars_per_trade: config.risk.fixed_dollars_per_trade,
              max_dollars_per_trade: config.risk.max_dollars_per_trade,
              min_dollars_per_trade: config.risk.min_dollars_per_trade,
              min_minutes_left: config.risk.min_minutes_left,
              min_minutes_elapsed: config.risk.min_minutes_elapsed,
              max_entry_ask_usd: config.risk.max_entry_ask_usd,
              time_in_force: config.risk.time_in_force,
              chase_above_ask_usd: config.risk.chase_above_ask_usd,
            }}
            testPrefix="auto"
            onChange={(key, value) => setRiskField(key as keyof RiskConfig, value as never)}
          />
          {metaFor(SMART_BUY_RISK_FIELD_KEYS).map((meta) => {
            if (meta.kind === 'toggle') {
              const on = config.risk.smart_buy_enabled !== false;
              return (
                <View key={meta.key} style={styles.field} testID={`risk-field-auto-${meta.key}`}>
                  <View style={styles.toggleRow}>
                    <View style={styles.labelWithInfo}>
                      <Text style={[styles.label, { marginBottom: 0 }]}>{meta.label}</Text>
                      <PathInfoIcon
                        title={PATH_INFO.smartBuy.title}
                        body={PATH_INFO.smartBuy.body}
                        testID="path-info-smartBuy"
                      />
                    </View>
                    <Switch
                      testID="risk-toggle-smart_buy_enabled"
                      value={on}
                      onValueChange={(v) => setRiskField('smart_buy_enabled', v)}
                      trackColor={{ true: colors.accent, false: colors.mute }}
                    />
                  </View>
                  <Text style={styles.hint}>
                    {on
                      ? 'On — only buy when our guess is at least Min extra chance above the ticket'
                      : 'Off — Auto uses cushion and risk only'}
                  </Text>
                </View>
              );
            }
            const disabled = config.risk.smart_buy_enabled === false;
            return (
              <RiskStepper
                key={meta.key}
                meta={meta}
                value={config.risk[meta.key]}
                testPrefix="auto"
                disabled={disabled}
                onChange={(next) => setRiskField(meta.key, next as never)}
              />
            );
          })}
          {metaFor(PROTECT_RISK_FIELD_KEYS).map((meta) => {
            if (meta.kind === 'toggle') {
              const on = Boolean(config.risk.protect_sell_enabled);
              return (
                <View key={meta.key} style={styles.field} testID={`risk-field-auto-${meta.key}`}>
                  <View style={styles.toggleRow}>
                    <View style={styles.labelWithInfo}>
                      <Text style={[styles.label, { marginBottom: 0 }]}>{meta.label}</Text>
                      <PathInfoIcon
                        title={PATH_INFO.protect.title}
                        body={PATH_INFO.protect.body}
                        testID="path-info-protect"
                      />
                    </View>
                    <Switch
                      testID="risk-toggle-protect_sell_enabled"
                      value={on}
                      onValueChange={(v) => setRiskField('protect_sell_enabled', v)}
                      trackColor={{ true: colors.accent, false: colors.mute }}
                    />
                  </View>
                  <Text style={styles.hint}>
                    {on
                      ? 'On — sell when the lean flips against you (after the wait)'
                      : 'Off — hold until the window settles'}
                  </Text>
                </View>
              );
            }
            const disabled = !config.risk.protect_sell_enabled;
            return (
              <RiskStepper
                key={meta.key}
                meta={meta}
                value={config.risk[meta.key]}
                testPrefix="auto"
                disabled={disabled}
                onChange={(next) => setRiskField(meta.key, next as never)}
              />
            );
          })}
          {cashOutFeatureOn ? <CashOutFields /> : null}
          {goldFadeFeatureOn ? <GoldFadeFields /> : null}
          {twapLockFeatureOn ? <TwapLockFields /> : null}
          {lastMinuteFeatureOn ? <LastMinuteFields /> : null}
        </>
      )}

      <Pressable
        testID="btn-restore-risk-tab"
        style={[styles.restoreBtn, busy && styles.restoreOff]}
        onPress={() => void restoreTab()}
        disabled={busy}
      >
        <Text style={styles.restoreText}>
          {tab === 'home' ? 'Restore Home Buy defaults' : 'Restore Auto-trade defaults'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function CashOutFields() {
  const config = useConfigStore((s) => s.config);
  const setRiskField = useConfigStore((s) => s.setRiskField);
  const on = Boolean(config.risk.cash_out_enabled);
  const assets = normalizeCashOutAssets(config.risk.cash_out_assets);
  const warn = cashOutEdgeWarn(Number(config.risk.cash_out_max_ask_usd), Number(config.risk.cash_out_bid_usd));
  return (
    <>
      {metaFor(CASH_OUT_RISK_FIELD_KEYS).map((meta) => {
        if (meta.kind === 'toggle') {
          const isThin = meta.key === 'cash_out_skip_thin_bid';
          const thinOn = Boolean(config.risk.cash_out_skip_thin_bid);
          return (
            <View key={meta.key} style={styles.field} testID={`risk-field-auto-${meta.key}`}>
              <View style={styles.toggleRow}>
                {isThin ? (
                  <Text style={[styles.label, { flex: 1 }]}>{meta.label}</Text>
                ) : (
                  <View style={styles.labelWithInfo}>
                    <Text style={[styles.label, { marginBottom: 0 }]}>{meta.label}</Text>
                    <PathInfoIcon
                      title={PATH_INFO.cashOut.title}
                      body={PATH_INFO.cashOut.body}
                      testID="path-info-cashOut"
                    />
                  </View>
                )}
                <Switch
                  testID={isThin ? 'risk-toggle-cash_out_skip_thin_bid' : 'risk-toggle-cash_out_enabled'}
                  value={isThin ? thinOn : on}
                  disabled={isThin && !on}
                  onValueChange={(v) =>
                    setRiskField(isThin ? 'cash_out_skip_thin_bid' : 'cash_out_enabled', v)
                  }
                  trackColor={{ true: colors.accent, false: colors.mute }}
                />
              </View>
              <Text style={styles.hint}>
                {isThin
                  ? thinOn
                    ? 'On — skip buy, and sell if you hold, when the bid pile is smaller than your contracts'
                    : 'Off — ignore how many contracts sit on the bid (default)'
                  : on
                    ? 'On — Cloud buys and sells only the checked assets on this path'
                    : 'Off — those assets stay on normal Auto-trade'}
              </Text>
            </View>
          );
        }
        const isPct = meta.key === 'cash_out_enter_pct';
        const isStop = meta.key === 'cash_out_stop_usd';
        return (
          <RiskStepper
            key={meta.key}
            meta={meta}
            value={config.risk[meta.key]}
            testPrefix="auto"
            disabled={!on}
            displayOverride={
              isPct
                ? `${Number(config.risk.cash_out_enter_pct)}%`
                : isStop
                  ? `${Math.round(Number(config.risk.cash_out_stop_usd) * 100)}¢`
                  : undefined
            }
            onChange={(next) => setRiskField(meta.key, next as never)}
          />
        );
      })}
      {on ? (
        <Text style={styles.hint} testID="cash-out-fill-edge-hint">
          Sell when the bid is up by Cash out bid minus max ask from what you paid. Paid $0.78 with
          $0.82 / $0.88 → sell at $0.84. Stop sells if the bid falls that many cents below what you
          paid (default 5¢).
        </Text>
      ) : null}
      {warn && on ? (
        <Text style={styles.hint} testID="cash-out-edge-warn">
          Cash out bid is less than 4¢ above max ask — little room to sell higher than you buy.
        </Text>
      ) : null}
      <View style={[styles.field, !on && { opacity: 0.45 }]} testID="risk-field-auto-cash_out_assets">
        <Text style={styles.label}>Cash out assets</Text>
        <Text style={styles.hint}>Default Gold. Empty means no Cash out buys.</Text>
        <View style={styles.tifRow}>
          {AssetRegistry.keys.map((key) => {
            const selected = assets.includes(key);
            return (
              <Pressable
                key={key}
                testID={`cash-out-asset-${key}`}
                disabled={!on}
                style={[styles.tifChip, selected && styles.tifChipOn, { flex: undefined, minWidth: 72 }]}
                onPress={() => {
                  const next = selected ? assets.filter((a) => a !== key) : [...assets, key];
                  setRiskField('cash_out_assets', next);
                }}
              >
                <Text style={[styles.tifText, selected && styles.tifTextOn]}>{key}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );
}

function GoldFadeFields() {
  const config = useConfigStore((s) => s.config);
  const setRiskField = useConfigStore((s) => s.setRiskField);
  const on = Boolean(config.risk.gold_fade_enabled);
  return (
    <>
      {metaFor(GOLD_FADE_RISK_FIELD_KEYS).map((meta) => {
        if (meta.kind === 'toggle') {
          return (
            <View key={meta.key} style={styles.field} testID={`risk-field-auto-${meta.key}`}>
              <View style={styles.toggleRow}>
                <View style={styles.labelWithInfo}>
                  <Text style={[styles.label, { marginBottom: 0 }]}>{meta.label}</Text>
                  <PathInfoIcon
                    title={PATH_INFO.goldFade.title}
                    body={PATH_INFO.goldFade.body}
                    testID="path-info-goldFade"
                  />
                </View>
                <Switch
                  testID="risk-toggle-gold_fade_enabled"
                  value={on}
                  onValueChange={(v) => setRiskField('gold_fade_enabled', v)}
                  trackColor={{ true: colors.accent, false: colors.mute }}
                />
              </View>
              <Text style={styles.hint}>
                {on
                  ? 'On — Cloud buys cheap Gold when the gap is small, then sells or dumps the lot'
                  : 'Off — Gold stays on Cash out / Auto-trade (default)'}
              </Text>
            </View>
          );
        }
        const isTake = meta.key === 'gold_fade_take_usd';
        const isStop = meta.key === 'gold_fade_stop_usd';
        const isFlat = meta.key === 'gold_fade_flatten_minutes';
        return (
          <RiskStepper
            key={meta.key}
            meta={meta}
            value={config.risk[meta.key]}
            testPrefix="auto"
            disabled={!on}
            displayOverride={
              isTake
                ? `${Math.round(Number(config.risk.gold_fade_take_usd) * 100)}¢`
                : isStop
                  ? `${Math.round(Number(config.risk.gold_fade_stop_usd) * 100)}¢`
                  : isFlat
                    ? `${Number(config.risk.gold_fade_flatten_minutes)} min`
                    : undefined
            }
            onChange={(next) => setRiskField(meta.key, next as never)}
          />
        );
      })}
      {on ? (
        <Text style={styles.hint} testID="gold-fade-hint">
          Gold only. Buy the cheaper ticket when the gap is at most Max gap. Sell all if the bid is
          up Take profit from what you paid, hits the stop, the book is thin, minutes left hit
          Flatten, or the window ends.
        </Text>
      ) : null}
    </>
  );
}

function TwapLockFields() {
  const config = useConfigStore((s) => s.config);
  const setRiskField = useConfigStore((s) => s.setRiskField);
  const on = Boolean(config.risk.twap_lock_enabled);
  const assets = normalizeTwapLockAssets(config.risk.twap_lock_assets);
  return (
    <>
      {metaFor(TWAP_LOCK_RISK_FIELD_KEYS).map((meta) => {
        if (meta.kind === 'toggle') {
          return (
            <View key={meta.key} style={styles.field} testID={`risk-field-auto-${meta.key}`}>
              <View style={styles.toggleRow}>
                <View style={styles.labelWithInfo}>
                  <Text style={[styles.label, { marginBottom: 0 }]}>{meta.label}</Text>
                  <PathInfoIcon
                    title={PATH_INFO.twapLock.title}
                    body={PATH_INFO.twapLock.body}
                    testID="path-info-twapLock"
                  />
                </View>
                <Switch
                  testID="risk-toggle-twap_lock_enabled"
                  value={on}
                  onValueChange={(v) => setRiskField('twap_lock_enabled', v)}
                  trackColor={{ true: colors.accent, false: colors.mute }}
                />
              </View>
              <Text style={styles.hint}>
                {on
                  ? 'On — checked coins leave Cash out and Auto; Cloud buys Yes only on a $0 leftover lock, then holds to $1'
                  : 'Off — BTC / ETH stay on Cash out / Auto-trade (default)'}
              </Text>
            </View>
          );
        }
        return (
          <RiskStepper
            key={meta.key}
            meta={meta}
            value={config.risk[meta.key]}
            testPrefix="auto"
            disabled={!on}
            onChange={(next) => setRiskField(meta.key, next as never)}
          />
        );
      })}
      <View style={[styles.field, !on && { opacity: 0.45 }]} testID="risk-field-auto-twap_lock_assets">
        <Text style={styles.label}>TWAP assets</Text>
        <Text style={styles.hint}>BTC and ETH only. Empty means no TWAP lock buys.</Text>
        <View style={styles.tifRow}>
          {TWAP_LOCK_ASSETS.map((key) => {
            const selected = assets.includes(key);
            return (
              <Pressable
                key={key}
                testID={`twap-lock-asset-${key}`}
                disabled={!on}
                style={[styles.tifChip, selected && styles.tifChipOn, { flex: undefined, minWidth: 72 }]}
                onPress={() => {
                  const next = selected ? assets.filter((a) => a !== key) : [...assets, key];
                  setRiskField('twap_lock_assets', next);
                }}
              >
                <Text style={[styles.tifText, selected && styles.tifTextOn]}>{key}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {on ? (
        <Text style={styles.hint} testID="twap-lock-hint">
          Checked coins leave Cash out and normal Auto. Most windows: no trade. A true lock
          usually appears in the last 1–3 seconds. If Yes is 98–99¢, we skip. Hold to
          settlement — no stop, fade, or dump. Skip thin bid (above) fails closed if the book
          size is unknown.
        </Text>
      ) : null}
    </>
  );
}

const LAST_MINUTE_SIDES: { value: LastMinuteSide; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'both', label: 'Both' },
];

function LastMinuteFields() {
  const config = useConfigStore((s) => s.config);
  const setRiskField = useConfigStore((s) => s.setRiskField);
  const on = Boolean(config.risk.last_minute_enabled);
  const side = normalizeLastMinuteSide(config.risk.last_minute_side);
  return (
    <>
      {metaFor(LAST_MINUTE_RISK_FIELD_KEYS).map((meta) => {
        if (meta.kind === 'toggle') {
          return (
            <View key={meta.key} style={styles.field} testID={`risk-field-auto-${meta.key}`}>
              <View style={styles.toggleRow}>
                <View style={styles.labelWithInfo}>
                  <Text style={[styles.label, { marginBottom: 0 }]}>{meta.label}</Text>
                  <PathInfoIcon
                    title={PATH_INFO.lastMinute.title}
                    body={PATH_INFO.lastMinute.body}
                    testID="path-info-lastMinute"
                  />
                </View>
                <Switch
                  testID="risk-toggle-last_minute_enabled"
                  value={on}
                  onValueChange={(v) => setRiskField('last_minute_enabled', v)}
                  trackColor={{ true: colors.accent, false: colors.mute }}
                />
              </View>
              <Text style={styles.hint}>
                {on
                  ? 'On — last 60s, 1s watch, any asset you have On. Hold to settlement'
                  : 'Off — no last-minute chase (default)'}
              </Text>
            </View>
          );
        }
        return (
          <RiskStepper
            key={meta.key}
            meta={meta}
            value={config.risk[meta.key]}
            testPrefix="auto"
            disabled={!on}
            onChange={(next) => setRiskField(meta.key, next as never)}
          />
        );
      })}
      <View style={[styles.field, !on && { opacity: 0.45 }]} testID="risk-field-auto-last_minute_side">
        <Text style={styles.label}>Side</Text>
        <View style={styles.tifRow}>
          {LAST_MINUTE_SIDES.map((opt) => {
            const selected = side === opt.value;
            return (
              <Pressable
                key={opt.value}
                testID={`last-minute-side-${opt.value}`}
                disabled={!on}
                style={[styles.tifChip, selected && styles.tifChipOn]}
                onPress={() => setRiskField('last_minute_side', opt.value)}
              >
                <Text style={[styles.tifText, selected && styles.tifTextOn]}>
                  {selected ? '☑' : '☐'} {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );
}

function PathFields({
  values,
  testPrefix,
  onChange,
}: {
  values: ManualPathRisk;
  testPrefix: string;
  onChange: <K extends keyof ManualPathRisk>(key: K, value: ManualPathRisk[K]) => void;
}) {
  return (
    <>
      {metaFor(PATH_RISK_FIELD_KEYS).map((meta) => {
        if (meta.kind === 'tif') {
          const cur = values.time_in_force;
          return (
            <View key={meta.key} style={styles.field} testID={`risk-field-${testPrefix}-time_in_force`}>
              <Text style={styles.label}>Time in force</Text>
              <View style={styles.tifRow}>
                {TIME_IN_FORCE_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    testID={`tif-${testPrefix}-${opt.value}`}
                    style={[styles.tifChip, cur === opt.value && styles.tifChipOn]}
                    onPress={() => onChange('time_in_force', opt.value as TimeInForce)}
                  >
                    <Text style={[styles.tifText, cur === opt.value && styles.tifTextOn]}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        }
        return (
          <RiskStepper
            key={meta.key}
            meta={meta}
            value={values[meta.key as keyof ManualPathRisk]}
            testPrefix={testPrefix}
            onChange={(next) => onChange(meta.key as keyof ManualPathRisk, next as never)}
          />
        );
      })}
    </>
  );
}

function RiskStepper({
  meta,
  value,
  testPrefix,
  onChange,
  disabled,
  displayOverride,
}: {
  meta: (typeof RISK_FIELD_META)[number];
  value: unknown;
  testPrefix: string;
  onChange: (next: number) => void;
  disabled?: boolean;
  displayOverride?: string;
}) {
  const display =
    displayOverride ??
    (meta.kind === 'chase' || meta.kind === 'money'
      ? `$${Number(value).toFixed(meta.kind === 'chase' ? 2 : 0)}`
      : meta.kind === 'ratio'
        ? `${Number(value).toFixed(2)}×`
        : meta.kind === 'seconds'
          ? `${Number(value)}s`
          : String(value));
  return (
    <View
      style={[styles.field, disabled && { opacity: 0.45 }]}
      testID={`risk-field-${testPrefix}-${meta.key}`}
    >
      <Text style={styles.label}>{meta.label}</Text>
      <View style={styles.stepRow}>
        <Pressable
          testID={`risk-down-${testPrefix}-${meta.key}`}
          style={styles.chip}
          disabled={disabled}
          onPress={() => onChange(Number(value) - meta.step)}
        >
          <Text style={styles.chipText}>−</Text>
        </Pressable>
        <Text style={styles.value} testID={`risk-value-${testPrefix}-${meta.key}`}>
          {display}
        </Text>
        <Pressable
          testID={`risk-up-${testPrefix}-${meta.key}`}
          style={styles.chip}
          disabled={disabled}
          onPress={() => onChange(Number(value) + meta.step)}
        >
          <Text style={styles.chipText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: 48 },
  lead: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  groupTitle: { color: colors.gold, fontWeight: '800', fontSize: 13, marginBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  labelWithInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  hint: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  field: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  label: { color: colors.textPrimary, fontWeight: '700', fontSize: 13, marginBottom: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chip: {
    width: 36,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { color: colors.textPrimary, fontWeight: '800', fontSize: 16 },
  value: { color: colors.textPrimary, fontWeight: '800', minWidth: 64, textAlign: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tifRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tifChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  tifChipOn: { borderColor: colors.gold, backgroundColor: 'rgba(198,167,94,0.15)' },
  tifText: { color: colors.textSecondary, fontWeight: '700' },
  tifTextOn: { color: colors.gold },
  tabRow: { flexDirection: 'row', gap: 8, marginTop: 16, marginBottom: 12 },
  tab: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabOn: { borderColor: colors.gold, backgroundColor: 'rgba(198,167,94,0.12)' },
  tabText: { color: colors.textSecondary, fontWeight: '800' },
  tabTextOn: { color: colors.gold },
  restoreBtn: {
    marginTop: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  restoreOff: { opacity: 0.45 },
  restoreText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
});
