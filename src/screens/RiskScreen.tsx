import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { AssetRegistry, ManualPathRisk, RiskConfig, TimeInForce } from '../config/types';
import {
  CASH_OUT_RISK_FIELD_KEYS,
  GOLD_FADE_RISK_FIELD_KEYS,
  LAST_MINUTE_RISK_FIELD_KEYS,
  STEP_BUY_RISK_FIELD_KEYS,
  SPIKE_FADE_RISK_FIELD_KEYS,
  PAIR_LOCK_RISK_FIELD_KEYS,
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
  normalizeLastMinuteAssets,
  normalizeLastMinuteSide,
} from '../../packages/trading-core/src/lastMinute';
import { normalizeStepBuyAssets } from '../../packages/trading-core/src/stepBuy';
import { normalizeSpikeFadeAssets } from '../../packages/trading-core/src/spikeFade';
import { normalizePairLockAssets } from '../../packages/trading-core/src/pairLock';
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
  const stepBuyFeatureOn = useRuntimeStore((s) => s.stepBuyFeatureOn);
  const spikeFadeFeatureOn = useRuntimeStore((s) => s.spikeFadeFeatureOn);
  const pairLockFeatureOn = useRuntimeStore((s) => s.pairLockFeatureOn);
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
          <View style={styles.pathInner} testID="risk-field-auto-smart_buy_enabled">
            <NestedCheckRow
              testID="risk-toggle-smart_buy_enabled"
              label="Smart buy"
              value={config.risk.smart_buy_enabled !== false}
              onChange={(v) => setRiskField('smart_buy_enabled', v)}
              info={{
                title: PATH_INFO.smartBuy.title,
                body: PATH_INFO.smartBuy.body,
                testID: 'path-info-smartBuy',
              }}
            />
            {config.risk.smart_buy_enabled !== false ? (
              <>
                {metaFor(SMART_BUY_RISK_FIELD_KEYS)
                  .filter((meta) => meta.kind !== 'toggle')
                  .map((meta) => (
                    <RiskStepper
                      key={meta.key}
                      meta={meta}
                      value={config.risk[meta.key]}
                      testPrefix="auto"
                      onChange={(next) => setRiskField(meta.key, next as never)}
                    />
                  ))}
                <Text style={styles.hint}>
                  Auto-trade only. Buy when our guess is at least Min extra chance above the ticket
                </Text>
              </>
            ) : null}
          </View>
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
                  {on ? (
                    <Text style={styles.hint}>Sell when the lean flips against you (after the wait)</Text>
                  ) : null}
                </View>
              );
            }
            if (!config.risk.protect_sell_enabled) return null;
            return (
              <RiskStepper
                key={meta.key}
                meta={meta}
                value={config.risk[meta.key]}
                testPrefix="auto"
                onChange={(next) => setRiskField(meta.key, next as never)}
              />
            );
          })}
          {cashOutFeatureOn ? <CashOutFields /> : null}
          {goldFadeFeatureOn ? <GoldFadeFields /> : null}
          {twapLockFeatureOn ? <TwapLockFields /> : null}
          {lastMinuteFeatureOn ? <LastMinuteFields /> : null}
          {stepBuyFeatureOn ? <StepBuyFields /> : null}
          {spikeFadeFeatureOn ? <SpikeFadeFields /> : null}
          {pairLockFeatureOn ? <PairLockFields /> : null}
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
  const thinOn = Boolean(config.risk.cash_out_skip_thin_bid);
  return (
    <>
      <View style={styles.field} testID="risk-field-auto-cash_out_enabled">
        <View style={styles.toggleRow}>
          <View style={styles.labelWithInfo}>
            <Text style={[styles.label, { marginBottom: 0 }]}>Cash out</Text>
            <PathInfoIcon
              title={PATH_INFO.cashOut.title}
              body={PATH_INFO.cashOut.body}
              testID="path-info-cashOut"
            />
          </View>
          <Switch
            testID="risk-toggle-cash_out_enabled"
            value={on}
            onValueChange={(v) => setRiskField('cash_out_enabled', v)}
            trackColor={{ true: colors.accent, false: colors.mute }}
          />
        </View>
        {on ? (
          <Text style={styles.hint}>Cloud buys and sells only the checked assets on this path</Text>
        ) : null}
      </View>
      {on ? (
        <View style={styles.pathInner}>
          <SkipThinBidRow
            testID="risk-toggle-cash_out_skip_thin_bid"
            value={thinOn}
            onChange={(v) => setRiskField('cash_out_skip_thin_bid', v)}
          />
          {metaFor(CASH_OUT_RISK_FIELD_KEYS)
            .filter((meta) => meta.key !== 'cash_out_enabled' && meta.key !== 'cash_out_skip_thin_bid')
            .map((meta) => {
              const isPct = meta.key === 'cash_out_enter_pct';
              const isStop = meta.key === 'cash_out_stop_usd';
              return (
                <RiskStepper
                  key={meta.key}
                  meta={meta}
                  value={config.risk[meta.key]}
                  testPrefix="auto"
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
          <Text style={styles.hint} testID="cash-out-fill-edge-hint">
            Sell when the bid is up by Cash out bid minus max ask from what you paid. Paid $0.78 with
            $0.82 / $0.88 → sell at $0.84. Stop sells if the bid falls that many cents below what you
            paid (default 5¢).
          </Text>
          {warn ? (
            <Text style={styles.hint} testID="cash-out-edge-warn">
              Cash out bid is less than 4¢ above max ask — little room to sell higher than you buy.
            </Text>
          ) : null}
          <View style={styles.field} testID="risk-field-auto-cash_out_assets">
            <Text style={styles.label}>Cash out assets</Text>
            <Text style={styles.hint}>Default Gold. Empty means no Cash out buys.</Text>
            <View style={styles.tifRow}>
              {AssetRegistry.keys.map((key) => {
                const selected = assets.includes(key);
                return (
                  <Pressable
                    key={key}
                    testID={`cash-out-asset-${key}`}
                    style={[styles.tifChip, selected && styles.tifChipOn, { flex: undefined, minWidth: 64 }]}
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
        </View>
      ) : null}
    </>
  );
}

function GoldFadeFields() {
  const config = useConfigStore((s) => s.config);
  const setRiskField = useConfigStore((s) => s.setRiskField);
  const on = Boolean(config.risk.gold_fade_enabled);
  return (
    <>
      <View style={styles.field} testID="risk-field-auto-gold_fade_enabled">
        <View style={styles.toggleRow}>
          <View style={styles.labelWithInfo}>
            <Text style={[styles.label, { marginBottom: 0 }]}>Gold fade</Text>
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
        {on ? (
          <Text style={styles.hint}>
            Cloud buys cheap Gold when the gap is small, then sells or dumps the lot
          </Text>
        ) : null}
      </View>
      {on ? (
        <View style={styles.pathInner}>
          <SkipThinBidRow
            testID="risk-toggle-gold_fade_skip_thin_bid"
            value={Boolean(config.risk.gold_fade_skip_thin_bid)}
            onChange={(v) => setRiskField('gold_fade_skip_thin_bid', v)}
          />
          {metaFor(GOLD_FADE_RISK_FIELD_KEYS)
            .filter((meta) => meta.key !== 'gold_fade_enabled')
            .map((meta) => {
              const isTake = meta.key === 'gold_fade_take_usd';
              const isStop = meta.key === 'gold_fade_stop_usd';
              const isFlat = meta.key === 'gold_fade_flatten_minutes';
              return (
                <RiskStepper
                  key={meta.key}
                  meta={meta}
                  value={config.risk[meta.key]}
                  testPrefix="auto"
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
          <Text style={styles.hint} testID="gold-fade-hint">
            Gold only. Buy the cheaper ticket when the gap is at most Max gap. Sell all if the bid is
            up Take profit from what you paid, hits the stop, the book is thin, minutes left hit
            Flatten, or the window ends.
          </Text>
        </View>
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
      <View style={styles.field} testID="risk-field-auto-twap_lock_enabled">
        <View style={styles.toggleRow}>
          <View style={styles.labelWithInfo}>
            <Text style={[styles.label, { marginBottom: 0 }]}>TWAP lock</Text>
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
        {on ? (
          <Text style={styles.hint}>
            Checked coins leave Cash out and Auto; Cloud buys Yes only on a $0 leftover lock, then
            holds to $1
          </Text>
        ) : null}
      </View>
      {on ? (
        <View style={styles.pathInner}>
          <SkipThinBidRow
            testID="risk-toggle-twap_lock_skip_thin_bid"
            value={Boolean(config.risk.twap_lock_skip_thin_bid)}
            onChange={(v) => setRiskField('twap_lock_skip_thin_bid', v)}
          />
          {metaFor(TWAP_LOCK_RISK_FIELD_KEYS)
            .filter((meta) => meta.key !== 'twap_lock_enabled')
            .map((meta) => (
              <RiskStepper
                key={meta.key}
                meta={meta}
                value={config.risk[meta.key]}
                testPrefix="auto"
                onChange={(next) => setRiskField(meta.key, next as never)}
              />
            ))}
          <View style={styles.field} testID="risk-field-auto-twap_lock_assets">
            <Text style={styles.label}>TWAP assets</Text>
            <Text style={styles.hint}>BTC and ETH only. Empty means no TWAP lock buys.</Text>
            <View style={styles.tifRow}>
              {TWAP_LOCK_ASSETS.map((key) => {
                const selected = assets.includes(key);
                return (
                  <Pressable
                    key={key}
                    testID={`twap-lock-asset-${key}`}
                    style={[styles.tifChip, selected && styles.tifChipOn, { flex: undefined, minWidth: 64 }]}
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
          <Text style={styles.hint} testID="twap-lock-hint">
            Checked coins leave Cash out and normal Auto. Most windows: no trade. A true lock
            usually appears in the last 1–3 seconds. If Yes is 98–99¢, we skip. Hold to
            settlement — no stop, fade, or dump. This path’s Skip thin bid fails closed if the
            book size is unknown.
          </Text>
        </View>
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
      <View style={styles.field} testID="risk-field-auto-last_minute_enabled">
        <View style={styles.toggleRow}>
          <View style={styles.labelWithInfo}>
            <Text style={[styles.label, { marginBottom: 0 }]}>Last-minute</Text>
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
        {on ? (
          <Text style={styles.hint}>
            Watch early, first clip only when Both still qualifies, then clip ladder. Hold to
            settlement
          </Text>
        ) : null}
      </View>
      {on ? (
        <View style={styles.pathInner}>
          <SkipThinBidRow
            testID="risk-toggle-last_minute_skip_thin_bid"
            value={Boolean(config.risk.last_minute_skip_thin_bid)}
            onChange={(v) => setRiskField('last_minute_skip_thin_bid', v)}
          />
          {metaFor(LAST_MINUTE_RISK_FIELD_KEYS)
            .filter((meta) => meta.key !== 'last_minute_enabled')
            .map((meta) => {
              const isGap = meta.key === 'last_minute_both_gap';
              const isFlip = meta.key === 'last_minute_flip_sell_usd';
              const flipUsd = Number(config.risk.last_minute_flip_sell_usd) || 0;
              return (
                <RiskStepper
                  key={meta.key}
                  meta={meta}
                  value={config.risk[meta.key]}
                  testPrefix="auto"
                  displayOverride={
                    isGap
                      ? `${Math.round(Number(config.risk.last_minute_both_gap) * 100)}¢`
                      : isFlip
                        ? flipUsd <= 0
                          ? 'Off'
                          : `${Math.round(flipUsd * 100)}¢`
                        : undefined
                  }
                  onChange={(next) => setRiskField(meta.key, next as never)}
                />
              );
            })}
          <View style={styles.field} testID="risk-field-auto-last_minute_assets">
            <Text style={styles.label}>Last-minute assets</Text>
            <Text style={styles.hint}>Also must be On in Cushions. Empty means no Last-minute buys.</Text>
            <View style={styles.tifRow}>
              {AssetRegistry.keys.map((key) => {
                const selected = normalizeLastMinuteAssets(config.risk.last_minute_assets).includes(key);
                return (
                  <Pressable
                    key={key}
                    testID={`last-minute-asset-${key}`}
                    style={[styles.tifChip, selected && styles.tifChipOn, { flex: undefined, minWidth: 64 }]}
                    onPress={() => {
                      const cur = normalizeLastMinuteAssets(config.risk.last_minute_assets);
                      const next = selected ? cur.filter((a) => a !== key) : [...cur, key];
                      setRiskField('last_minute_assets', next);
                    }}
                  >
                    <Text style={[styles.tifText, selected && styles.tifTextOn]}>{key}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={styles.field} testID="risk-field-auto-last_minute_side">
            <Text style={styles.label}>Side</Text>
            <View style={styles.tifRow}>
              {LAST_MINUTE_SIDES.map((opt) => {
                const selected = side === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    testID={`last-minute-side-${opt.value}`}
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
          <Text style={styles.hint} testID="last-minute-hint">
            Watch quotes from Watch start. First 1-contract clip only when Both still qualifies
            (usually last 60–90s), not at minute 13. Then +clip every Ladder wait while it is still
            the favorite and the live ask is at or under Entry ask. Stop with Stop seconds left or a
            $1.00 ask. Window cap 1 still blocks the first clip if Auto or Cash out already filled
            this coin; ladder clips after that first Last-minute fill are extra. Sell if flip is Off
            unless you set it — then a real opposite-side flip of that many cents sells only those
            lots and frees the clip slots.
          </Text>
        </View>
      ) : null}
    </>
  );
}

function StepBuyFields() {
  const config = useConfigStore((s) => s.config);
  const setRiskField = useConfigStore((s) => s.setRiskField);
  const on = Boolean(config.risk.step_buy_enabled);
  return (
    <>
      <View style={styles.field} testID="risk-field-auto-step_buy_enabled">
        <View style={styles.toggleRow}>
          <View style={styles.labelWithInfo}>
            <Text style={[styles.label, { marginBottom: 0 }]}>Step buy</Text>
            <PathInfoIcon title={PATH_INFO.stepBuy.title} body={PATH_INFO.stepBuy.body} testID="path-info-stepBuy" />
          </View>
          <Switch
            testID="risk-toggle-step_buy_enabled"
            value={on}
            onValueChange={(v) => setRiskField('step_buy_enabled', v)}
            trackColor={{ true: colors.accent, false: colors.mute }}
          />
        </View>
        {on ? (
          <Text style={styles.hint}>Scale in after Start after if Cushion % still holds. Per-lot ask stop.</Text>
        ) : null}
      </View>
      {on ? (
        <View style={styles.pathInner}>
          <SkipThinBidRow
            testID="risk-toggle-step_buy_skip_thin_bid"
            value={Boolean(config.risk.step_buy_skip_thin_bid)}
            onChange={(v) => setRiskField('step_buy_skip_thin_bid', v)}
          />
          {metaFor(STEP_BUY_RISK_FIELD_KEYS)
            .filter((meta) => meta.key !== 'step_buy_enabled')
            .map((meta) => {
              const pct = meta.key === 'step_buy_cushion_pct';
              const wait = meta.key === 'step_buy_add_wait_minutes';
              const band = meta.key === 'step_buy_add_band_usd';
              const stop = meta.key === 'step_buy_stop_usd';
              const stepper = (
                <RiskStepper
                  key={meta.key}
                  meta={meta}
                  value={config.risk[meta.key]}
                  testPrefix="auto"
                  displayOverride={
                    pct
                      ? `${Math.round(Number(config.risk.step_buy_cushion_pct) || 0)}%`
                      : wait
                        ? `${Math.round(Number(config.risk.step_buy_add_wait_minutes) || 0)} min`
                        : band
                          ? `${Math.round(Number(config.risk.step_buy_add_band_usd) * 100)}¢`
                          : stop
                            ? `${Math.round(Number(config.risk.step_buy_stop_usd) * 100)}¢`
                            : undefined
                  }
                  onChange={(next) => setRiskField(meta.key, next as never)}
                />
              );
              if (!band) return stepper;
              return (
                <View key={meta.key}>
                  {stepper}
                  <Text style={styles.hint} testID="step-buy-add-band-hint">
                    Lots 2+ only. Live ask must be the last fill, or up to this many ¢ richer
                    (0–10¢). A 5¢ jump with a 2¢ band waits — Cloud does not chase. 0¢ = next ask
                    must match the last fill.
                  </Text>
                </View>
              );
            })}
          <View style={styles.field} testID="risk-field-auto-step_buy_assets">
            <Text style={styles.label}>Step buy assets</Text>
            <Text style={styles.hint}>Also must be On in Cushions. Empty means no Step buy buys.</Text>
            <View style={styles.tifRow}>
              {AssetRegistry.keys.map((key) => {
                const selected = normalizeStepBuyAssets(config.risk.step_buy_assets).includes(key);
                return (
                  <Pressable
                    key={key}
                    testID={`step-buy-asset-${key}`}
                    style={[styles.tifChip, selected && styles.tifChipOn, { flex: undefined, minWidth: 64 }]}
                    onPress={() => {
                      const cur = normalizeStepBuyAssets(config.risk.step_buy_assets);
                      const next = selected ? cur.filter((a) => a !== key) : [...cur, key];
                      setRiskField('step_buy_assets', next);
                    }}
                  >
                    <Text style={[styles.tifText, selected && styles.tifTextOn]}>{key}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.hint} testID="step-buy-hint">
            Lot 1 after Start after + Cushion % + lean. Later lots need Add wait, thesis still on,
            and ask in last fill … last fill + Add band. Stop adding with 30s left. Stop sells a lot
            when ask is Stop ¢ under that lot’s fill; lot 1 stop sells all remaining Step buy lots.
          </Text>
        </View>
      ) : null}
    </>
  );
}

function SpikeFadeFields() {
  const config = useConfigStore((s) => s.config);
  const setRiskField = useConfigStore((s) => s.setRiskField);
  const on = Boolean(config.risk.spike_fade_enabled);
  return (
    <>
      <View style={styles.field} testID="risk-field-auto-spike_fade_enabled">
        <View style={styles.toggleRow}>
          <View style={styles.labelWithInfo}>
            <Text style={[styles.label, { marginBottom: 0 }]}>Spike fade</Text>
            <PathInfoIcon title={PATH_INFO.spikeFade.title} body={PATH_INFO.spikeFade.body} testID="path-info-spikeFade" />
          </View>
          <Switch
            testID="risk-toggle-spike_fade_enabled"
            value={on}
            onValueChange={(v) => setRiskField('spike_fade_enabled', v)}
            trackColor={{ true: colors.accent, false: colors.mute }}
          />
        </View>
        {on ? (
          <Text style={styles.hint}>
            Buy the cheap side when the expensive ask is in band. Always dumps — take, stop, or flatten.
          </Text>
        ) : null}
      </View>
      {on ? (
        <View style={styles.pathInner}>
          <SkipThinBidRow
            testID="risk-toggle-spike_fade_skip_thin_bid"
            value={Boolean(config.risk.spike_fade_skip_thin_bid)}
            onChange={(v) => setRiskField('spike_fade_skip_thin_bid', v)}
          />
          {metaFor(SPIKE_FADE_RISK_FIELD_KEYS)
            .filter((meta) => meta.key !== 'spike_fade_enabled')
            .map((meta) => {
              const start = meta.key === 'spike_fade_start_minutes';
              const until = meta.key === 'spike_fade_until_minutes';
              const flatten = meta.key === 'spike_fade_flatten_minutes';
              return (
                <RiskStepper
                  key={meta.key}
                  meta={meta}
                  value={config.risk[meta.key]}
                  testPrefix="auto"
                  displayOverride={
                    start
                      ? `${Math.round(Number(config.risk.spike_fade_start_minutes) || 0)} min`
                      : until
                        ? `${Math.round(Number(config.risk.spike_fade_until_minutes) || 0)}`
                        : flatten
                          ? `${Math.round(Number(config.risk.spike_fade_flatten_minutes) || 0)} min`
                          : undefined
                  }
                  onChange={(next) => setRiskField(meta.key, next as never)}
                />
              );
            })}
          <View style={styles.field} testID="risk-field-auto-spike_fade_assets">
            <Text style={styles.label}>Spike fade assets</Text>
            <Text style={styles.hint}>Also must be On in Cushions. Empty means no Spike fade buys.</Text>
            <View style={styles.tifRow}>
              {AssetRegistry.keys.map((key) => {
                const selected = normalizeSpikeFadeAssets(config.risk.spike_fade_assets).includes(key);
                return (
                  <Pressable
                    key={key}
                    testID={`spike-fade-asset-${key}`}
                    style={[styles.tifChip, selected && styles.tifChipOn, { flex: undefined, minWidth: 64 }]}
                    onPress={() => {
                      const cur = normalizeSpikeFadeAssets(config.risk.spike_fade_assets);
                      const next = selected ? cur.filter((a) => a !== key) : [...cur, key];
                      setRiskField('spike_fade_assets', next);
                    }}
                  >
                    <Text style={[styles.tifText, selected && styles.tifTextOn]}>{key}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.hint} testID="spike-fade-hint">
            After Start after and before Until minute. Expensive-side ask in Expensive min…max and
            cheap-side ask in Cheap min…max → buy the cheap side. Take when that bid ≥ Take ask.
            Stop when that ask ≤ Stop ask. Flatten with Flatten left. Always dumps. Gold fade stays
            a separate Gold-only path.
          </Text>
        </View>
      ) : null}
    </>
  );
}

function PairLockFields() {
  const config = useConfigStore((s) => s.config);
  const setRiskField = useConfigStore((s) => s.setRiskField);
  const on = Boolean(config.risk.pair_lock_enabled);
  return (
    <>
      <View style={styles.field} testID="risk-field-auto-pair_lock_enabled">
        <View style={styles.toggleRow}>
          <View style={styles.labelWithInfo}>
            <Text style={[styles.label, { marginBottom: 0 }]}>Pair lock</Text>
            <PathInfoIcon title={PATH_INFO.pairLock.title} body={PATH_INFO.pairLock.body} testID="path-info-pairLock" />
          </View>
          <Switch
            testID="risk-toggle-pair_lock_enabled"
            value={on}
            onValueChange={(v) => setRiskField('pair_lock_enabled', v)}
            trackColor={{ true: colors.accent, false: colors.mute }}
          />
        </View>
        {on ? (
          <Text style={styles.hint}>
            Buy the lean side, then the opposite when the pair spends less than $1 − Min lock. Flatten
            unmatched only. A locked pair holds to settlement.
          </Text>
        ) : null}
      </View>
      {on ? (
        <View style={styles.pathInner}>
          <SkipThinBidRow
            testID="risk-toggle-pair_lock_skip_thin_bid"
            value={Boolean(config.risk.pair_lock_skip_thin_bid)}
            onChange={(v) => setRiskField('pair_lock_skip_thin_bid', v)}
          />
          {metaFor(PAIR_LOCK_RISK_FIELD_KEYS)
            .filter((meta) => meta.key !== 'pair_lock_enabled')
            .map((meta) => {
              const start = meta.key === 'pair_lock_start_minutes';
              const until = meta.key === 'pair_lock_until_minutes';
              const flatten = meta.key === 'pair_lock_flatten_minutes';
              return (
                <RiskStepper
                  key={meta.key}
                  meta={meta}
                  value={config.risk[meta.key]}
                  testPrefix="auto"
                  displayOverride={
                    start
                      ? `${Math.round(Number(config.risk.pair_lock_start_minutes) || 0)} min`
                      : until
                        ? `${Math.round(Number(config.risk.pair_lock_until_minutes) || 0)}`
                        : flatten
                          ? `${Math.round(Number(config.risk.pair_lock_flatten_minutes) || 0)} min`
                          : undefined
                  }
                  onChange={(next) => setRiskField(meta.key, next as never)}
                />
              );
            })}
          <View style={styles.field} testID="risk-field-auto-pair_lock_assets">
            <Text style={styles.label}>Pair lock assets</Text>
            <Text style={styles.hint}>Also must be On in Cushions. Empty means no Pair lock buys.</Text>
            <View style={styles.tifRow}>
              {AssetRegistry.keys.map((key) => {
                const selected = normalizePairLockAssets(config.risk.pair_lock_assets).includes(key);
                return (
                  <Pressable
                    key={key}
                    testID={`pair-lock-asset-${key}`}
                    style={[styles.tifChip, selected && styles.tifChipOn, { flex: undefined, minWidth: 64 }]}
                    onPress={() => {
                      const cur = normalizePairLockAssets(config.risk.pair_lock_assets);
                      const next = selected ? cur.filter((a) => a !== key) : [...cur, key];
                      setRiskField('pair_lock_assets', next);
                    }}
                  >
                    <Text style={[styles.tifText, selected && styles.tifTextOn]}>{key}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.hint} testID="pair-lock-hint">
            After Start after and before Until minute. Auto lean and Runner max ask → buy that side.
            Hedge the other side when runner fill + opposite ask ≤ $1 − Min lock. Flatten unmatched
            with Flatten unmatched. A completed pair holds to $1.
          </Text>
        </View>
      ) : null}
    </>
  );
}

function NestedCheckRow({
  testID,
  label,
  value,
  onChange,
  info,
}: {
  testID: string;
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  info?: { title: string; body: string; testID: string };
}) {
  return (
    <View style={styles.skipThinRow}>
      <Pressable
        testID={testID}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: value }}
        accessibilityLabel={label}
        onPress={() => onChange(!value)}
        style={styles.nestedCheckHit}
      >
        <Text style={[styles.skipThinMark, value && styles.skipThinMarkOn]}>{value ? '☑' : '☐'}</Text>
        <Text style={[styles.skipThinLabel, value && styles.skipThinLabelOn]}>{label}</Text>
      </Pressable>
      {info ? <PathInfoIcon title={info.title} body={info.body} testID={info.testID} /> : null}
    </View>
  );
}

function SkipThinBidRow({
  testID,
  value,
  onChange,
}: {
  testID: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return <NestedCheckRow testID={testID} label="Skip thin bid" value={value} onChange={onChange} />;
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
              <View style={styles.stepRow}>
                <Text style={[styles.label, { flex: 1, marginBottom: 0 }]}>Time in force</Text>
                <View style={[styles.tifRow, { flex: 2 }]}>
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
      <View style={styles.stepRow}>
        <Text style={[styles.label, { flex: 1, marginBottom: 0 }]} numberOfLines={2}>
          {meta.label}
        </Text>
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
  lead: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  groupTitle: { color: colors.gold, fontWeight: '800', fontSize: 12, marginBottom: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  labelWithInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  hint: { color: colors.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 4, marginBottom: 6 },
  field: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginBottom: 5,
  },
  label: { color: colors.textPrimary, fontWeight: '700', fontSize: 12, marginBottom: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: {
    width: 30,
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { color: colors.textPrimary, fontWeight: '800', fontSize: 15 },
  value: { color: colors.textPrimary, fontWeight: '800', minWidth: 52, textAlign: 'center', fontSize: 13 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pathInner: {
    marginLeft: 14,
    marginBottom: 4,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(198,167,94,0.35)',
  },
  skipThinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(198,167,94,0.06)',
  },
  nestedCheckHit: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  skipThinMark: { color: colors.textSecondary, fontSize: 15, lineHeight: 18, width: 18 },
  skipThinMarkOn: { color: colors.gold },
  skipThinLabel: { color: colors.textSecondary, fontWeight: '600', fontSize: 12 },
  skipThinLabelOn: { color: colors.gold },
  tifRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tifChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingVertical: 5,
    alignItems: 'center',
  },
  tifChipOn: { borderColor: colors.gold, backgroundColor: 'rgba(198,167,94,0.15)' },
  tifText: { color: colors.textSecondary, fontWeight: '700', fontSize: 12 },
  tifTextOn: { color: colors.gold },
  tabRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 8 },
  tab: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  tabOn: { borderColor: colors.gold, backgroundColor: 'rgba(198,167,94,0.12)' },
  tabText: { color: colors.textSecondary, fontWeight: '800', fontSize: 13 },
  tabTextOn: { color: colors.gold },
  restoreBtn: {
    marginTop: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  restoreOff: { opacity: 0.45 },
  restoreText: { color: colors.textPrimary, fontWeight: '700', fontSize: 12 },
});
