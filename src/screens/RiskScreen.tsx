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
  CAP_LOCK_RISK_FIELD_KEYS,
  BUFFER_RUN_RISK_FIELD_KEYS,
  CHEAP_LOOP_RISK_FIELD_KEYS,
  CHEAP_LOOP_HOURLY_RISK_FIELD_KEYS,
  CHEAP_LOOP_WEEKLY_RISK_FIELD_KEYS,
  PATH_RISK_FIELD_KEYS,
  CUSHION_LEAN_ENTER_FIELD_KEYS,
  CUSHION_LEAN_MAX_GAP_FIELD_KEYS,
  HOME_ENTER_CUSHION_FIELD_KEYS,
  HOME_SELL_AT_RISK_FIELD_KEYS,
  CUSHION_LEAN_SELL_AT_RISK_FIELD_KEYS,
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
import { normalizeSellAtPct } from '../../packages/trading-core/src/protectSell';
import { normalizeTwapLockAssets, TWAP_LOCK_ASSETS } from '../../packages/trading-core/src/twapLock';
import {
  LastMinuteSide,
  normalizeLastMinuteAssets,
  normalizeLastMinuteSide,
} from '../../packages/trading-core/src/lastMinute';
import {
  normalizeStepBuyAddCushionPct,
  normalizeStepBuyAssets,
  normalizeStepBuyCushionPct,
} from '../../packages/trading-core/src/stepBuy';
import { normalizeSpikeFadeAssets } from '../../packages/trading-core/src/spikeFade';
import { normalizePairLockAssets } from '../../packages/trading-core/src/pairLock';
import { normalizeCapLockAssets } from '../../packages/trading-core/src/capLock';
import {
  BUFFER_RUN_ASSETS,
  normalizeBufferRunAssets,
} from '../../packages/trading-core/src/bufferRun';
import {
  CHEAP_LOOP_HOURLY_SERIES,
  CHEAP_LOOP_WEEKLY_SERIES,
  normalizeCheapLoopAssets,
  normalizeCheapLoopHourlyAssets,
  normalizeCheapLoopWeeklyAssets,
} from '../../packages/trading-core/src/cheapLoop';
import { PathInfoIcon } from '../components/PathInfoIcon';
import { PATH_INFO } from '../content/pathInfo';
import { PathFocusId } from '../content/pathCatalog';

type TabId = 'home' | 'auto';

export type RiskScreenProps = {
  focus?: PathFocusId;
  route?: { params?: { focus?: PathFocusId } };
};

function metaFor(keys: (keyof RiskConfig)[]) {
  return RISK_FIELD_META.filter((m) => keys.includes(m.key));
}

export function RiskScreen({ focus, route }: RiskScreenProps = {}) {
  const resolvedFocus = focus ?? route?.params?.focus;
  const showAll = !resolvedFocus;
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
  const capLockFeatureOn = useRuntimeStore((s) => s.capLockFeatureOn);
  const bufferRunFeatureOn = useRuntimeStore((s) => s.bufferRunFeatureOn);
  const cheapLoopFeatureOn = useRuntimeStore((s) => s.cheapLoopFeatureOn);
  const [tab, setTab] = useState<TabId>(resolvedFocus === 'auto' ? 'auto' : 'home');
  const [busy, setBusy] = useState(false);
  const showShared = showAll || resolvedFocus === 'shared';
  const showHome = resolvedFocus === 'home' || (showAll && tab === 'home');
  const showAutoCore = resolvedFocus === 'auto' || (showAll && tab === 'auto');
  const extra = (id: PathFocusId, flag: boolean) =>
    flag && (resolvedFocus === id || (showAll && tab === 'auto'));
  const showRestoreTab = showAll || resolvedFocus === 'home' || resolvedFocus === 'auto';
  const cushionLeanOn = config.risk.cushion_lean_enabled !== false;

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
      const home = resolvedFocus === 'home' || (!resolvedFocus && tab === 'home');
      if (home) await restoreHomeBuyRiskTab();
      else await restoreAutoRiskTab();
    } catch (e: any) {
      Alert.alert('Could not restore', String(e?.message || e || 'Restore failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="screen-risk">
      {showAll ? (
        <Text style={styles.lead}>
          Shared limits apply to Home Buy and Auto-trade. Each tab has its own size and timing.
        </Text>
      ) : null}

      {showShared ? (
        <>
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
        </>
      ) : null}

      {showAll ? (
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
      ) : null}

      {showHome ? (
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
          {metaFor(HOME_ENTER_CUSHION_FIELD_KEYS).map((meta) => (
            <RiskStepper
              key={meta.key}
              meta={meta}
              value={config.risk[meta.key]}
              testPrefix="home"
              onChange={(next) => setRiskField(meta.key, next as never)}
            />
          ))}
          <Text style={styles.hint} testID="risk-home-enter-cushion-hint">
            Home Buy only. Buy when the live gap is at least this many times the coin’s cushion
            (default 1× = full cushion). Cushion lean has its own Enter ×.
          </Text>
          {metaFor(HOME_SELL_AT_RISK_FIELD_KEYS).map((meta) => (
            <RiskStepper
              key={meta.key}
              meta={meta}
              value={normalizeSellAtPct(config.risk.home_sell_at_pct)}
              testPrefix="home"
              onChange={(next) => setRiskField('home_sell_at_pct', normalizeSellAtPct(next))}
            />
          ))}
          <Text style={styles.hint} testID="risk-home-sell-at-hint">
            Dump when live mark is at least this % above your fill. 0 = Off. Uses Protect wait/grace.
            Independent of Protect money lean-flip.
          </Text>
        </>
      ) : null}

      {showAutoCore ? (
        <>
          <View style={styles.field} testID="risk-field-auto-cushion_lean_enabled">
            <View style={styles.toggleRow}>
              <View style={styles.labelWithInfo}>
                <Text style={[styles.label, { marginBottom: 0 }]}>Cushion lean</Text>
                <PathInfoIcon title={PATH_INFO.auto.title} body={PATH_INFO.auto.body} testID="path-info-auto" />
              </View>
              <Switch
                testID="risk-toggle-cushion_lean_enabled"
                value={cushionLeanOn}
                onValueChange={(v) => setRiskField('cushion_lean_enabled', v)}
                trackColor={{ true: colors.accent, false: colors.mute }}
              />
            </View>
            <Text style={styles.hint} testID="risk-auto-hint">
              {cushionLeanOn
                ? 'Used only when Settings Auto-trade is On. Off = no gap>cushion buys. Last-minute and other paths keep their own switches. Protect money can still exit a Home Buy fill.'
                : 'Off = no gap>cushion buys. Last-minute and other paths keep their own switches. Settings Auto-trade still kills every path. Protect money still works.'}
            </Text>
          </View>
          {cushionLeanOn ? (
            <>
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
          {metaFor(CUSHION_LEAN_SELL_AT_RISK_FIELD_KEYS).map((meta) => (
            <RiskStepper
              key={meta.key}
              meta={meta}
              value={normalizeSellAtPct(config.risk.cushion_lean_sell_at_pct)}
              testPrefix="auto"
              onChange={(next) =>
                setRiskField('cushion_lean_sell_at_pct', normalizeSellAtPct(next))
              }
            />
          ))}
          <Text style={styles.hint} testID="risk-auto-sell-at-hint">
            Dump when live mark is at least this % above your fill. 0 = Off. Uses Protect wait/grace.
            Independent of Protect money lean-flip.
          </Text>
          {metaFor(CUSHION_LEAN_ENTER_FIELD_KEYS).map((meta) => (
            <RiskStepper
              key={meta.key}
              meta={meta}
              value={config.risk[meta.key]}
              testPrefix="auto"
              onChange={(next) => setRiskField(meta.key, next as never)}
            />
          ))}
          <Text style={styles.hint} testID="risk-auto-enter-cushion-hint">
            Cushion lean only. Buy when the live gap is at least this many times the coin’s cushion
            (default 1× = full cushion). Home Buy ignores this.
          </Text>
          {metaFor(CUSHION_LEAN_MAX_GAP_FIELD_KEYS).map((meta) => (
            <RiskStepper
              key={meta.key}
              meta={meta}
              value={config.risk[meta.key]}
              testPrefix="auto"
              onChange={(next) => setRiskField(meta.key, next as never)}
            />
          ))}
          <Text style={styles.hint} testID="risk-auto-max-gap-hint">
            Cushion lean only. Sit out when the live gap is at least this many times the coin’s
            cushion (default 2.5×). Home Buy ignores this.
          </Text>
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
                  Cushion lean only. Buy when our guess is at least Min extra chance above the ticket
                </Text>
              </>
            ) : null}
          </View>
            </>
          ) : null}
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
        </>
      ) : null}

      {extra('cashOut', cashOutFeatureOn) ? <CashOutFields /> : null}
      {extra('goldFade', goldFadeFeatureOn) ? <GoldFadeFields /> : null}
      {extra('twapLock', twapLockFeatureOn) ? <TwapLockFields /> : null}
      {extra('lastMinute', lastMinuteFeatureOn) ? <LastMinuteFields /> : null}
      {extra('stepBuy', stepBuyFeatureOn) ? <StepBuyFields /> : null}
      {extra('spikeFade', spikeFadeFeatureOn) ? <SpikeFadeFields /> : null}
      {extra('pairLock', pairLockFeatureOn) ? <PairLockFields /> : null}
      {extra('capLock', capLockFeatureOn) ? <CapLockFields /> : null}
      {extra('bufferRun', bufferRunFeatureOn) ? <BufferRunFields /> : null}
      {extra('cheapLoop', cheapLoopFeatureOn) ? <CheapLoopFields /> : null}

      {showRestoreTab ? (
      <Pressable
        testID="btn-restore-risk-tab"
        style={[styles.restoreBtn, busy && styles.restoreOff]}
        onPress={() => void restoreTab()}
        disabled={busy}
      >
        <Text style={styles.restoreText}>
          {resolvedFocus === 'home' || (!resolvedFocus && tab === 'home')
            ? 'Restore Home Buy defaults'
            : 'Restore Auto-trade defaults'}
        </Text>
      </Pressable>
      ) : null}
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
          <Text style={styles.hint} testID="cash-out-size-hint">
            This path’s size. Missing $ on an old phone seeds from Cushion lean. After that,
            Cushion lean $ no longer changes Cash out.
          </Text>
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
          <Text style={styles.hint} testID="gold-fade-size-hint">
            This path’s size. Missing $ on an old phone seeds from Cushion lean. After that,
            Cushion lean $ no longer changes Gold fade.
          </Text>
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
          <Text style={styles.hint} testID="twap-lock-size-hint">
            This path’s size. Missing $ on an old phone seeds from Cushion lean. After that,
            Cushion lean $ no longer changes TWAP lock.
          </Text>
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
            .filter(
              (meta) =>
                meta.key !== 'last_minute_enabled' &&
                meta.key !== 'last_minute_atr_cushion_enabled' &&
                meta.key !== 'last_minute_atr_ask_usd' &&
                meta.key !== 'last_minute_atr_mult'
            )
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
          <NestedCheckRow
            testID="risk-toggle-last_minute_atr_cushion_enabled"
            label="Late ATR cushion"
            value={config.risk.last_minute_atr_cushion_enabled !== false}
            onChange={(v) => setRiskField('last_minute_atr_cushion_enabled', v)}
          />
          {config.risk.last_minute_atr_cushion_enabled !== false ? (
            <>
              {metaFor(['last_minute_atr_ask_usd', 'last_minute_atr_mult'] as (keyof RiskConfig)[]).map(
                (meta) => (
                  <RiskStepper
                    key={meta.key}
                    meta={meta}
                    value={config.risk[meta.key]}
                    testPrefix="auto"
                    onChange={(next) => setRiskField(meta.key, next as never)}
                  />
                )
              )}
              <Text style={styles.hint} testID="last-minute-atr-hint">
                Final 60s only, when the chosen ask is at least High ask floor. Needs lead ≥ ATR ×
                (1m noise from this window’s path) when that path can be measured. Missing path does
                not block.
              </Text>
            </>
          ) : null}
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
          <Text style={styles.hint}>
            Scale in after Start after if Cushion % still holds. Add cushion % is stricter for lots
            2+. Sell if thesis dies dumps the stack.
          </Text>
        ) : null}
      </View>
      {on ? (
        <View style={styles.pathInner}>
          <NestedCheckRow
            testID="risk-toggle-step_buy_sell_if_thesis_dies"
            label="Sell if thesis dies"
            value={config.risk.step_buy_sell_if_thesis_dies !== false}
            onChange={(v) => setRiskField('step_buy_sell_if_thesis_dies', v)}
          />
          <SkipThinBidRow
            testID="risk-toggle-step_buy_skip_thin_bid"
            value={Boolean(config.risk.step_buy_skip_thin_bid)}
            onChange={(v) => setRiskField('step_buy_skip_thin_bid', v)}
          />
          {metaFor(STEP_BUY_RISK_FIELD_KEYS)
            .filter((meta) => meta.key !== 'step_buy_enabled')
            .map((meta) => {
              const lotPct = meta.key === 'step_buy_cushion_pct';
              const addPct = meta.key === 'step_buy_add_cushion_pct';
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
                    lotPct
                      ? `${Math.round(Number(config.risk.step_buy_cushion_pct) || 0)}%`
                      : addPct
                        ? `${Math.round(Number(config.risk.step_buy_add_cushion_pct) || 0)}%`
                        : wait
                          ? `${Math.round(Number(config.risk.step_buy_add_wait_minutes) || 0)} min`
                          : band
                            ? `${Math.round(Number(config.risk.step_buy_add_band_usd) * 100)}¢`
                            : stop
                              ? `${Math.round(Number(config.risk.step_buy_stop_usd) * 100)}¢`
                              : undefined
                  }
                  onChange={(next) => {
                    if (meta.key === 'step_buy_cushion_pct') {
                      const lot1 = normalizeStepBuyCushionPct(next);
                      setRiskField('step_buy_cushion_pct', lot1);
                      setRiskField(
                        'step_buy_add_cushion_pct',
                        normalizeStepBuyAddCushionPct(config.risk.step_buy_add_cushion_pct, lot1)
                      );
                      return;
                    }
                    if (meta.key === 'step_buy_add_cushion_pct') {
                      setRiskField(
                        'step_buy_add_cushion_pct',
                        normalizeStepBuyAddCushionPct(next, config.risk.step_buy_cushion_pct)
                      );
                      return;
                    }
                    setRiskField(meta.key, next as never);
                  }}
                />
              );
              if (addPct) {
                return (
                  <View key={meta.key}>
                    {stepper}
                    <Text style={styles.hint} testID="step-buy-add-cushion-hint">
                      Lots 2+ only. Default 75%. Never below Cushion %. Lot 1 still uses Cushion %.
                    </Text>
                  </View>
                );
              }
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
            Lot 1 after Start after + Cushion % + lean. Later lots need Add wait, Add cushion %,
            lean still with you, and ask in last fill … last fill + Add band. Stop adding with 30s
            left. Stop sells a lot when ask is Stop ¢ under that lot’s fill; lot 1 stop sells all
            remaining Step buy lots. Sell if thesis dies (default On) dumps the stack at the live
            bid when the gap is under Cushion % or the lean flips. 1s watcher uses live bid/ask.
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
            {config.risk.pair_lock_lock_first !== false
              ? 'Lock first On: buy both sides together only if they already lock Min lock. One-leg miss waits Recover wait, then hedge / take / smaller dump.'
              : 'Lock first Off: more first legs at/under Runner max. If the book already locks Min lock, both IOC together. Else buy the runner, then Recover wait (even hedge ≤ 99¢, or take +2¢, or smaller-hole). Flatten unmatched and Runner stop still dump leftovers.'}{' '}
            Add new pair 0 = first pair only; 3 = 3 more after the first. A locked pair holds to
            settlement.
          </Text>
        ) : null}
      </View>
      {on ? (
        <View style={styles.pathInner}>
          <NestedCheckRow
            testID="risk-toggle-pair_lock_lock_first"
            label="Lock first"
            value={config.risk.pair_lock_lock_first !== false}
            onChange={(v) => setRiskField('pair_lock_lock_first', v)}
          />
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
              const recover = meta.key === 'pair_lock_recover_seconds';
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
                          : recover
                            ? `${Math.round(Number(config.risk.pair_lock_recover_seconds) || 0)}s`
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
            After Start after and before Until minute. Auto lean and Runner max ask
            {config.risk.pair_lock_lock_first !== false
              ? ', and only if the opposite ask already locks at least Min lock'
              : ''}
            . If both sides already lock Min lock → YES and NO IOC together. One-leg miss waits Recover
            wait. Lock first Off can buy the runner alone. Hedge at Min lock every 1s. After Recover
            wait, buy the other side if fill + ask ≤ 99¢, else take +2¢ on the runner bid, else
            finish vs dump — finish only when that hole is strictly smaller. Add new pair 0–3 extra
            after the first lock. Flatten unmatched with Flatten unmatched. A completed pair holds to
            $1.
          </Text>
        </View>
      ) : null}
    </>
  );
}

function CapLockFields() {
  const config = useConfigStore((s) => s.config);
  const setRiskField = useConfigStore((s) => s.setRiskField);
  const on = Boolean(config.risk.cap_lock_enabled);
  return (
    <>
      <View style={styles.field} testID="risk-field-auto-cap_lock_enabled">
        <View style={styles.toggleRow}>
          <View style={styles.labelWithInfo}>
            <Text style={[styles.label, { marginBottom: 0 }]}>Cap lock</Text>
            <PathInfoIcon title={PATH_INFO.capLock.title} body={PATH_INFO.capLock.body} testID="path-info-capLock" />
          </View>
          <Switch
            testID="risk-toggle-cap_lock_enabled"
            value={on}
            onValueChange={(v) => setRiskField('cap_lock_enabled', v)}
            trackColor={{ true: colors.accent, false: colors.mute }}
          />
        </View>
        {on ? (
          <Text style={styles.hint}>
            Buy YES and NO on the same ticker when the two asks plus fees still fit Max lock loss.
            One pair. No lean. Matched pair holds to $1. Unmatched leftover flattens.
          </Text>
        ) : null}
      </View>
      {on ? (
        <View style={styles.pathInner}>
          <NestedCheckRow
            testID="risk-toggle-cap_lock_allow_later"
            label="Allow later"
            value={config.risk.cap_lock_allow_later !== false}
            onChange={(v) => setRiskField('cap_lock_allow_later', v)}
          />
          {metaFor(CAP_LOCK_RISK_FIELD_KEYS)
            .filter((meta) => meta.key !== 'cap_lock_enabled')
            .map((meta) => {
              const openSec = meta.key === 'cap_lock_window_open_seconds';
              return (
                <RiskStepper
                  key={meta.key}
                  meta={meta}
                  value={config.risk[meta.key]}
                  testPrefix="auto"
                  displayOverride={
                    openSec
                      ? `${Math.round(Number(config.risk.cap_lock_window_open_seconds) || 0)}s`
                      : undefined
                  }
                  onChange={(next) => setRiskField(meta.key, next as never)}
                />
              );
            })}
          <View style={styles.field} testID="risk-field-auto-cap_lock_assets">
            <Text style={styles.label}>Cap lock assets</Text>
            <Text style={styles.hint}>Also must be On in Cushions. Empty means no Cap lock buys.</Text>
            <View style={styles.tifRow}>
              {AssetRegistry.keys.map((key) => {
                const selected = normalizeCapLockAssets(config.risk.cap_lock_assets).includes(key);
                return (
                  <Pressable
                    key={key}
                    testID={`cap-lock-asset-${key}`}
                    style={[styles.tifChip, selected && styles.tifChipOn, { flex: undefined, minWidth: 64 }]}
                    onPress={() => {
                      const cur = normalizeCapLockAssets(config.risk.cap_lock_assets);
                      const next = selected ? cur.filter((a) => a !== key) : [...cur, key];
                      setRiskField('cap_lock_assets', next);
                    }}
                  >
                    <Text style={[styles.tifText, selected && styles.tifTextOn]}>{key}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.hint} testID="cap-lock-hint">
            Prefer Try first. Allow later On: still enter once if the book later fits.
            Skip if YES+NO+fees would lose more than Max lock loss. First IOC 0 fill does not send
            the second. A matched pair holds to settlement.
          </Text>
        </View>
      ) : null}
    </>
  );
}

function BufferRunFields() {
  const config = useConfigStore((s) => s.config);
  const setRiskField = useConfigStore((s) => s.setRiskField);
  const on = Boolean(config.risk.buffer_run_enabled);
  return (
    <>
      <View style={styles.field} testID="risk-field-auto-buffer_run_enabled">
        <View style={styles.toggleRow}>
          <View style={styles.labelWithInfo}>
            <Text style={[styles.label, { marginBottom: 0 }]}>Buffer run</Text>
            <PathInfoIcon
              title={PATH_INFO.bufferRun.title}
              body={PATH_INFO.bufferRun.body}
              testID="path-info-bufferRun"
            />
          </View>
          <Switch
            testID="risk-toggle-buffer_run_enabled"
            value={on}
            onValueChange={(v) => setRiskField('buffer_run_enabled', v)}
            trackColor={{ true: colors.accent, false: colors.mute }}
          />
        </View>
        {on ? (
          <Text style={styles.hint}>
            Mid-window lean scalp when spot has a buffer vs strike and the lead ask is mid-range.
            Take, stop, lean-flip, or flatten — one trade per window. Never hold to $1.
          </Text>
        ) : null}
      </View>
      {on ? (
        <View style={styles.pathInner}>
          <SkipThinBidRow
            testID="risk-toggle-buffer_run_skip_thin_bid"
            value={Boolean(config.risk.buffer_run_skip_thin_bid)}
            onChange={(v) => setRiskField('buffer_run_skip_thin_bid', v)}
          />
          {metaFor(BUFFER_RUN_RISK_FIELD_KEYS)
            .filter((meta) => meta.key !== 'buffer_run_enabled')
            .map((meta) => (
              <RiskStepper
                key={meta.key}
                meta={meta}
                value={config.risk[meta.key]}
                testPrefix="auto"
                onChange={(next) => setRiskField(meta.key, next as never)}
              />
            ))}
          <View style={styles.field} testID="risk-field-auto-buffer_run_assets">
            <Text style={styles.label}>Buffer run assets</Text>
            <Text style={styles.hint}>BTC and ETH only. Also must be On in Cushions. Empty means no Buffer run buys.</Text>
            <View style={styles.tifRow}>
              {BUFFER_RUN_ASSETS.map((key) => {
                const selected = normalizeBufferRunAssets(config.risk.buffer_run_assets).includes(key);
                return (
                  <Pressable
                    key={key}
                    testID={`buffer-run-asset-${key}`}
                    style={[styles.tifChip, selected && styles.tifChipOn, { flex: undefined, minWidth: 64 }]}
                    onPress={() => {
                      const cur = normalizeBufferRunAssets(config.risk.buffer_run_assets);
                      const next = selected ? cur.filter((a) => a !== key) : [...cur, key];
                      setRiskField('buffer_run_assets', next);
                    }}
                  >
                    <Text style={[styles.tifText, selected && styles.tifTextOn]}>{key}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.hint} testID="buffer-run-hint">
            Enter after Enter after minutes and while Enter left remain. Lead ≥ max(min gap,
            ATR ×). Ask must sit in Ask min…Ask max. Skip if YES+NO ≤ Pair-sum skip. Exit on
            Take, Stop, lean flip, or Flatten left. TWAP / Last-minute / Spike / Step / Pair /
            Cap / Cheap sit this coin out while Buffer run owns it.
          </Text>
        </View>
      ) : null}
    </>
  );
}

function CheapLoopFields() {
  const config = useConfigStore((s) => s.config);
  const setRiskField = useConfigStore((s) => s.setRiskField);
  const on = Boolean(config.risk.cheap_loop_enabled);
  const hourlyOn = Boolean(config.risk.cheap_loop_hourly_enabled);
  const weeklyOn = Boolean(config.risk.cheap_loop_weekly_enabled);
  return (
    <>
      <View style={styles.field} testID="risk-field-auto-cheap_loop_enabled">
        <View style={styles.toggleRow}>
          <View style={styles.labelWithInfo}>
            <Text style={[styles.label, { marginBottom: 0 }]}>15 min</Text>
            <PathInfoIcon title={PATH_INFO.cheapLoop.title} body={PATH_INFO.cheapLoop.body} testID="path-info-cheapLoop" />
          </View>
          <Switch
            testID="risk-toggle-cheap_loop_enabled"
            value={on}
            onValueChange={(v) => setRiskField('cheap_loop_enabled', v)}
            trackColor={{ true: colors.accent, false: colors.mute }}
          />
        </View>
        {on ? (
          <Text style={styles.hint}>
            Buy the cheaper 15m ticket. Hold until Take, Stop (if On), or Flatten. Never both
            sides. Never hold to $1.
          </Text>
        ) : null}
      </View>
      {on ? (
        <View style={styles.pathInner}>
          <SkipThinBidRow
            testID="risk-toggle-cheap_loop_skip_thin_bid"
            value={Boolean(config.risk.cheap_loop_skip_thin_bid)}
            onChange={(v) => setRiskField('cheap_loop_skip_thin_bid', v)}
          />
          {metaFor(CHEAP_LOOP_RISK_FIELD_KEYS)
            .filter((meta) => meta.key !== 'cheap_loop_enabled')
            .map((meta) => {
              const start = meta.key === 'cheap_loop_start_minutes';
              const flatten = meta.key === 'cheap_loop_flatten_minutes';
              const hold = meta.key === 'cheap_loop_min_hold_minutes';
              const cool = meta.key === 'cheap_loop_cooldown_minutes';
              const livePct = meta.key === 'cheap_loop_min_live_cushion_pct';
              const stepper = (
                <RiskStepper
                  key={meta.key}
                  meta={meta}
                  value={config.risk[meta.key]}
                  testPrefix="auto"
                  displayOverride={
                    start
                      ? `${Math.round(Number(config.risk.cheap_loop_start_minutes) || 0)} min`
                      : flatten
                        ? `${Math.round(Number(config.risk.cheap_loop_flatten_minutes) || 0)} min`
                        : hold
                          ? `${Math.round(Number(config.risk.cheap_loop_min_hold_minutes) || 0)} min`
                          : cool
                            ? `${Math.round(Number(config.risk.cheap_loop_cooldown_minutes) || 0)} min`
                            : livePct
                              ? `${Math.round(Number(config.risk.cheap_loop_min_live_cushion_pct) || 0)}%`
                              : undefined
                  }
                  onChange={(next) => setRiskField(meta.key, next as never)}
                />
              );
              if (meta.key !== 'cheap_loop_take_usd') return stepper;
              return (
                <React.Fragment key={meta.key}>
                  {stepper}
                  <CheapLoopStopBlock
                    enabledKey="cheap_loop_stop_enabled"
                    usdKey="cheap_loop_stop_usd"
                    enabled={config.risk.cheap_loop_stop_enabled === true}
                    usd={Number(config.risk.cheap_loop_stop_usd)}
                    onEnabled={(v) => setRiskField('cheap_loop_stop_enabled', v)}
                    onUsd={(next) => setRiskField('cheap_loop_stop_usd', next)}
                  />
                </React.Fragment>
              );
            })}
          <View style={styles.field} testID="risk-field-auto-cheap_loop_assets">
            <Text style={styles.label}>Cheap loop assets</Text>
            <Text style={styles.hint}>Also must be On in Cushions. Empty means no Cheap loop buys.</Text>
            <View style={styles.tifRow}>
              {AssetRegistry.keys.map((key) => {
                const selected = normalizeCheapLoopAssets(config.risk.cheap_loop_assets).includes(key);
                return (
                  <Pressable
                    key={key}
                    testID={`cheap-loop-asset-${key}`}
                    style={[styles.tifChip, selected && styles.tifChipOn, { flex: undefined, minWidth: 64 }]}
                    onPress={() => {
                      const cur = normalizeCheapLoopAssets(config.risk.cheap_loop_assets);
                      const next = selected ? cur.filter((a) => a !== key) : [...cur, key];
                      setRiskField('cheap_loop_assets', next);
                    }}
                  >
                    <Text style={[styles.tifText, selected && styles.tifTextOn]}>{key}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.hint} testID="cheap-loop-hint">
            After Start after and before Flatten left. Cheaper ask 20¢–Cheap max (default 40¢),
            other ask ≤ 80¢, |YES − NO| ≥ Min gap, and |live − strike| ≥ Min live % of that coin’s
            Cushions $ → buy that side. 11¢ / 90¢ sits. Same % for every chip; BTC and SOL use
            their own cushion. 0% = off. After Min hold, take when that bid ≥ fill + Take. Stop
            default Off — On sells bid IOC when that bid ≤ fill − Stop. Flatten in the last Flatten
            left minutes. Then Cooldown. Cycles is how many exits this ticker this window. Always
            dumps. History Sell dumps a pending 15m fill now (bid IOC). Spike fade / Step buy /
            Pair lock still take first pick.
          </Text>
        </View>
      ) : null}
      <View style={styles.field} testID="risk-field-auto-cheap_loop_hourly_enabled">
        <View style={styles.toggleRow}>
          <View style={styles.labelWithInfo}>
            <Text style={[styles.label, { marginBottom: 0 }]}>Hourly</Text>
            <PathInfoIcon
              title={PATH_INFO.cheapLoopHourly.title}
              body={PATH_INFO.cheapLoopHourly.body}
              testID="path-info-cheapLoopHourly"
            />
          </View>
          <Switch
            testID="risk-toggle-cheap_loop_hourly_enabled"
            value={hourlyOn}
            onValueChange={(v) => setRiskField('cheap_loop_hourly_enabled', v)}
            trackColor={{ true: colors.accent, false: colors.mute }}
          />
        </View>
        {hourlyOn ? (
          <Text style={styles.hint}>
            ATM strike on Kalshi hourly above/below. Take, optional Stop, or Flatten. Own clocks.
            Not the 15m book.
          </Text>
        ) : null}
      </View>
      {hourlyOn ? (
        <View style={styles.pathInner}>
          <SkipThinBidRow
            testID="risk-toggle-cheap_loop_hourly_skip_thin_bid"
            value={Boolean(config.risk.cheap_loop_hourly_skip_thin_bid)}
            onChange={(v) => setRiskField('cheap_loop_hourly_skip_thin_bid', v)}
          />
          {metaFor(CHEAP_LOOP_HOURLY_RISK_FIELD_KEYS)
            .filter((meta) => meta.key !== 'cheap_loop_hourly_enabled')
            .map((meta) => {
              const start = meta.key === 'cheap_loop_hourly_start_minutes';
              const flatten = meta.key === 'cheap_loop_hourly_flatten_minutes';
              const hold = meta.key === 'cheap_loop_hourly_min_hold_minutes';
              const cool = meta.key === 'cheap_loop_hourly_cooldown_minutes';
              const stepper = (
                <RiskStepper
                  key={meta.key}
                  meta={meta}
                  value={config.risk[meta.key]}
                  testPrefix="auto"
                  displayOverride={
                    start
                      ? `${Math.round(Number(config.risk.cheap_loop_hourly_start_minutes) || 0)} min`
                      : flatten
                        ? `${Math.round(Number(config.risk.cheap_loop_hourly_flatten_minutes) || 0)} min`
                        : hold
                          ? `${Math.round(Number(config.risk.cheap_loop_hourly_min_hold_minutes) || 0)} min`
                          : cool
                            ? `${Math.round(Number(config.risk.cheap_loop_hourly_cooldown_minutes) || 0)} min`
                            : undefined
                  }
                  onChange={(next) => setRiskField(meta.key, next as never)}
                />
              );
              if (meta.key !== 'cheap_loop_hourly_take_usd') return stepper;
              return (
                <React.Fragment key={meta.key}>
                  {stepper}
                  <CheapLoopStopBlock
                    enabledKey="cheap_loop_hourly_stop_enabled"
                    usdKey="cheap_loop_hourly_stop_usd"
                    enabled={config.risk.cheap_loop_hourly_stop_enabled === true}
                    usd={Number(config.risk.cheap_loop_hourly_stop_usd)}
                    onEnabled={(v) => setRiskField('cheap_loop_hourly_stop_enabled', v)}
                    onUsd={(next) => setRiskField('cheap_loop_hourly_stop_usd', next)}
                  />
                </React.Fragment>
              );
            })}
          <View style={styles.field} testID="risk-field-auto-cheap_loop_hourly_assets">
            <Text style={styles.label}>Hourly assets</Text>
            <Text style={styles.hint}>
              Hourly above/below only. Also On in Cushions. Empty means no hourly buys.
            </Text>
            <View style={styles.tifRow}>
              {Object.keys(CHEAP_LOOP_HOURLY_SERIES).map((key) => {
                const selected = normalizeCheapLoopHourlyAssets(config.risk.cheap_loop_hourly_assets).includes(
                  key
                );
                return (
                  <Pressable
                    key={key}
                    testID={`cheap-loop-hourly-asset-${key}`}
                    style={[styles.tifChip, selected && styles.tifChipOn, { flex: undefined, minWidth: 64 }]}
                    onPress={() => {
                      const cur = normalizeCheapLoopHourlyAssets(config.risk.cheap_loop_hourly_assets);
                      const next = selected ? cur.filter((a) => a !== key) : [...cur, key];
                      setRiskField('cheap_loop_hourly_assets', next);
                    }}
                  >
                    <Text style={[styles.tifText, selected && styles.tifTextOn]}>{key}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.hint} testID="cheap-loop-hourly-hint">
            Buys the cheaper YES or NO on the unique ATM strike. Hold that ticker until Take, Stop
            (if On), or Flatten. Does not hop strikes. Cycles are per hour event (max 10). One open
            hourly lot per coin.
          </Text>
        </View>
      ) : null}
      <View style={styles.field} testID="risk-field-auto-cheap_loop_weekly_enabled">
        <View style={styles.toggleRow}>
          <View style={styles.labelWithInfo}>
            <Text style={[styles.label, { marginBottom: 0 }]}>Weekly</Text>
            <PathInfoIcon
              title={PATH_INFO.cheapLoopWeekly.title}
              body={PATH_INFO.cheapLoopWeekly.body}
              testID="path-info-cheapLoopWeekly"
            />
          </View>
          <Switch
            testID="risk-toggle-cheap_loop_weekly_enabled"
            value={weeklyOn}
            onValueChange={(v) => setRiskField('cheap_loop_weekly_enabled', v)}
            trackColor={{ true: colors.accent, false: colors.mute }}
          />
        </View>
        {weeklyOn ? (
          <Text style={styles.hint}>
            Same KX*D series as Hourly. Picks the 3–14 day event by duration. Buy cheap ATM
            (default ≤45¢, 8¢ gap), take 8¢ or stop 12¢, cooldown, look again until Flatten
            (default 2 hours left).
          </Text>
        ) : null}
      </View>
      {weeklyOn ? (
        <View style={styles.pathInner}>
          <SkipThinBidRow
            testID="risk-toggle-cheap_loop_weekly_skip_thin_bid"
            value={Boolean(config.risk.cheap_loop_weekly_skip_thin_bid)}
            onChange={(v) => setRiskField('cheap_loop_weekly_skip_thin_bid', v)}
          />
          {metaFor(CHEAP_LOOP_WEEKLY_RISK_FIELD_KEYS)
            .filter((meta) => meta.key !== 'cheap_loop_weekly_enabled')
            .map((meta) => {
              const start = meta.key === 'cheap_loop_weekly_start_minutes';
              const flatten = meta.key === 'cheap_loop_weekly_flatten_minutes';
              const hold = meta.key === 'cheap_loop_weekly_min_hold_minutes';
              const cool = meta.key === 'cheap_loop_weekly_cooldown_minutes';
              const stepper = (
                <RiskStepper
                  key={meta.key}
                  meta={meta}
                  value={config.risk[meta.key]}
                  testPrefix="auto"
                  displayOverride={
                    start
                      ? `${Math.round(Number(config.risk.cheap_loop_weekly_start_minutes) || 0)} min`
                      : flatten
                        ? (() => {
                            const m = Math.round(Number(config.risk.cheap_loop_weekly_flatten_minutes) || 0);
                            return m >= 60 && m % 60 === 0 ? `${m / 60} hr` : `${m} min`;
                          })()
                        : hold
                          ? `${Math.round(Number(config.risk.cheap_loop_weekly_min_hold_minutes) || 0)} min`
                          : cool
                            ? `${Math.round(Number(config.risk.cheap_loop_weekly_cooldown_minutes) || 0)} min`
                            : undefined
                  }
                  onChange={(next) => setRiskField(meta.key, next as never)}
                />
              );
              if (meta.key !== 'cheap_loop_weekly_take_usd') return stepper;
              return (
                <React.Fragment key={meta.key}>
                  {stepper}
                  <CheapLoopStopBlock
                    enabledKey="cheap_loop_weekly_stop_enabled"
                    usdKey="cheap_loop_weekly_stop_usd"
                    enabled={config.risk.cheap_loop_weekly_stop_enabled === true}
                    usd={Number(config.risk.cheap_loop_weekly_stop_usd)}
                    onEnabled={(v) => setRiskField('cheap_loop_weekly_stop_enabled', v)}
                    onUsd={(next) => setRiskField('cheap_loop_weekly_stop_usd', next)}
                  />
                </React.Fragment>
              );
            })}
          <View style={styles.field} testID="risk-field-auto-cheap_loop_weekly_assets">
            <Text style={styles.label}>Weekly assets</Text>
            <Text style={styles.hint}>
              Same series as Hourly. Cloud picks the weekly-length event. Also On in Cushions. Empty
              means no weekly buys.
            </Text>
            <View style={styles.tifRow}>
              {Object.keys(CHEAP_LOOP_WEEKLY_SERIES).map((key) => {
                const selected = normalizeCheapLoopWeeklyAssets(config.risk.cheap_loop_weekly_assets).includes(
                  key
                );
                return (
                  <Pressable
                    key={key}
                    testID={`cheap-loop-weekly-asset-${key}`}
                    style={[styles.tifChip, selected && styles.tifChipOn, { flex: undefined, minWidth: 64 }]}
                    onPress={() => {
                      const cur = normalizeCheapLoopWeeklyAssets(config.risk.cheap_loop_weekly_assets);
                      const next = selected ? cur.filter((a) => a !== key) : [...cur, key];
                      setRiskField('cheap_loop_weekly_assets', next);
                    }}
                  >
                    <Text style={[styles.tifText, selected && styles.tifTextOn]}>{key}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.hint} testID="cheap-loop-weekly-hint">
            Buys the cheaper YES or NO on unique ATM. After Take or Stop, Cooldown minutes, then
            hunt ATM again. Cycles are exits this weekly event (default 10, max 50). One open
            weekly lot per coin.
            History Sell dumps now without waiting for Take, Stop, or Flatten.
          </Text>
        </View>
      ) : null}
    </>
  );
}

function CheapLoopStopBlock({
  enabledKey,
  usdKey,
  enabled,
  usd,
  onEnabled,
  onUsd,
}: {
  enabledKey: string;
  usdKey: keyof RiskConfig;
  enabled: boolean;
  usd: number;
  onEnabled: (next: boolean) => void;
  onUsd: (next: number) => void;
}) {
  const meta = RISK_FIELD_META.find((m) => m.key === usdKey);
  return (
    <>
      <View style={styles.field} testID={`risk-field-auto-${enabledKey}`}>
        <View style={styles.toggleRow}>
          <Text style={[styles.label, { marginBottom: 0 }]}>Stop</Text>
          <Switch
            testID={`risk-toggle-${enabledKey}`}
            value={enabled}
            onValueChange={onEnabled}
            trackColor={{ true: colors.accent, false: colors.mute }}
          />
        </View>
        <Text style={styles.hint}>
          {enabled
            ? 'After Min hold, sell bid IOC if that bid is fill − Stop (5–12¢). Take + raises Stop if Take would catch it.'
            : 'Off. A falling ticket holds until Take or Flatten.'}
        </Text>
      </View>
      {enabled && meta ? (
        <RiskStepper meta={meta} value={usd} testPrefix="auto" onChange={onUsd} />
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
    (meta.kind === 'percent'
      ? Number(value) <= 0
        ? 'Off'
        : `${Number(value)}%`
      : meta.kind === 'chase' || meta.kind === 'money'
        ? `$${Number(value).toFixed(meta.kind === 'chase' ? 2 : 0)}`
        : meta.kind === 'ratio'
          ? `${Number(value).toFixed(2)}×`
          : meta.kind === 'seconds'
            ? `${Number(value)}s`
            : String(value));
  const atMax = Number.isFinite(Number(meta.max)) && Number(value) + meta.step > Number(meta.max) + 1e-9;
  const atMin = Number.isFinite(Number(meta.min)) && Number(value) - meta.step < Number(meta.min) - 1e-9;
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
          style={[styles.chip, (disabled || atMin) && { opacity: 0.35 }]}
          disabled={disabled || atMin}
          onPress={() => onChange(Number(value) - meta.step)}
        >
          <Text style={styles.chipText}>−</Text>
        </Pressable>
        <Text style={styles.value} testID={`risk-value-${testPrefix}-${meta.key}`}>
          {display}
        </Text>
        <Pressable
          testID={`risk-up-${testPrefix}-${meta.key}`}
          style={[styles.chip, (disabled || atMax) && { opacity: 0.35 }]}
          disabled={disabled || atMax}
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
