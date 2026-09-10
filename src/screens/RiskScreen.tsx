import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { ManualPathRisk, RiskConfig, TimeInForce } from '../config/types';
import {
  PATH_RISK_FIELD_KEYS,
  PROTECT_RISK_FIELD_KEYS,
  RISK_FIELD_META,
  SHARED_RISK_FIELD_KEYS,
  SMART_BUY_RISK_FIELD_KEYS,
  TIME_IN_FORCE_OPTIONS,
} from '../config/riskDefaults';
import { useConfigStore } from '../state/configStore';

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

      <Text style={styles.groupTitle}>Shared limits</Text>
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
          <Text style={styles.hint} testID="risk-auto-hint">
            Used only when Auto-trade is On. Smart buy is Auto-only. Protect money can still exit a
            Home Buy fill.
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
                    <Text style={[styles.label, { flex: 1 }]}>{meta.label}</Text>
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
                    <Text style={[styles.label, { flex: 1 }]}>{meta.label}</Text>
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
}: {
  meta: (typeof RISK_FIELD_META)[number];
  value: unknown;
  testPrefix: string;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const display =
    meta.kind === 'chase' || meta.kind === 'money'
      ? `$${Number(value).toFixed(meta.kind === 'chase' ? 2 : 0)}`
      : meta.kind === 'ratio'
        ? `${Number(value).toFixed(2)}×`
        : meta.kind === 'seconds'
          ? `${Number(value)}s`
          : String(value);
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
  tifRow: { flexDirection: 'row', gap: 8 },
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
