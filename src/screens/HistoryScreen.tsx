import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { useRuntimeStore } from '../state/runtimeStore';
import {
  ALERT_FILTERS,
  TRADE_FILTERS,
  AlertFilter,
  TradeFilter,
  alertFilterLabel,
  filterAlerts,
  filterTrades,
} from '../history/filters';

export function HistoryScreen() {
  const [tab, setTab] = useState<'trades' | 'alerts'>('trades');
  const [alertFilter, setAlertFilter] = useState<AlertFilter>('all');
  const [tradeFilter, setTradeFilter] = useState<TradeFilter>('all');
  const trades = useRuntimeStore((s) => s.trades);
  const alerts = useRuntimeStore((s) => s.alerts);

  const filteredTrades = useMemo(
    () => filterTrades(trades, tradeFilter),
    [trades, tradeFilter]
  );
  const filteredAlerts = useMemo(
    () => filterAlerts(alerts, alertFilter),
    [alerts, alertFilter]
  );

  return (
    <View style={styles.root} testID="screen-history">
      <View style={styles.seg}>
        <Seg
          testID="seg-trades"
          label="Trades"
          active={tab === 'trades'}
          onPress={() => setTab('trades')}
        />
        <Seg
          testID="seg-alerts"
          label="Alerts"
          active={tab === 'alerts'}
          onPress={() => setTab('alerts')}
        />
      </View>

      {tab === 'trades' ? (
        <>
          <FilterRow
            testID="history-trade-filters"
            options={TRADE_FILTERS}
            active={tradeFilter}
            onChange={setTradeFilter}
          />
          <Text style={styles.count} testID="history-trade-count">
            {filteredTrades.length} of {trades.length}
          </Text>
          {trades.length === 0 ? (
            <Empty text="No trades yet" sub="Filled and pending orders appear here." />
          ) : filteredTrades.length === 0 ? (
            <Empty text="No matching trades" sub="Try another filter." />
          ) : (
            <FlatList
              data={filteredTrades}
              keyExtractor={(i) => i.id}
              renderItem={({ item }) => (
                <View style={styles.row} testID={`trade-row-${item.id}`}>
                  <Text style={styles.title}>
                    {item.asset} {item.side} · {item.outcome}
                  </Text>
                  <Text style={styles.sub}>
                    {item.market_ticker} · cost ${item.notional_usd.toFixed(2)}
                    {item.fill_count != null ? ` · ${item.fill_count} ctr` : ''}
                    {item.pnl_usd != null ? ` · P&L $${item.pnl_usd.toFixed(2)}` : ''}
                  </Text>
                  <Text style={styles.time}>{new Date(item.at).toLocaleString()}</Text>
                </View>
              )}
            />
          )}
        </>
      ) : (
        <>
          <FilterRow
            testID="history-alert-filters"
            options={ALERT_FILTERS}
            active={alertFilter}
            onChange={setAlertFilter}
          />
          <Text style={styles.count} testID="history-alert-count">
            {filteredAlerts.length} of {alerts.length}
          </Text>
          {alerts.length === 0 ? (
            <Empty text="No alerts yet" sub="Lean signals and order events log here." />
          ) : filteredAlerts.length === 0 ? (
            <Empty text="No matching alerts" sub="Try another filter." />
          ) : (
            <FlatList
              data={filteredAlerts}
              keyExtractor={(i) => i.id}
              renderItem={({ item }) => (
                <View style={[styles.row, !item.read && styles.unread]} testID={`alert-row-${item.id}`}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.sub}>{item.body}</Text>
                  <Text style={styles.time}>
                    {alertFilterLabel(item.kind)} · {new Date(item.at).toLocaleString()}
                  </Text>
                </View>
              )}
            />
          )}
        </>
      )}
    </View>
  );
}

function FilterRow<T extends string>({
  options,
  active,
  onChange,
  testID,
}: {
  options: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  testID?: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filters}
      testID={testID}
      style={styles.filtersScroll}
    >
      {options.map((opt) => {
        const on = opt.id === active;
        return (
          <Pressable
            key={opt.id}
            testID={`filter-${opt.id}`}
            style={[styles.chip, on && styles.chipOn]}
            onPress={() => onChange(opt.id)}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Seg({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable style={[styles.segBtn, active && styles.segActive]} onPress={onPress} testID={testID}>
      <Text style={[styles.segText, active && { color: colors.bg }]}>{label}</Text>
    </Pressable>
  );
}

function Empty({ text, sub }: { text: string; sub: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{text}</Text>
      <Text style={styles.emptySub}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  seg: { flexDirection: 'row', gap: 8, marginBottom: spacing.sm },
  segBtn: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  segActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  segText: { color: colors.textPrimary, fontWeight: '700' },
  filtersScroll: { maxHeight: 40, marginBottom: 6 },
  filters: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  chipTextOn: { color: colors.bg },
  count: { color: colors.mute, fontSize: 11, marginBottom: 8, fontWeight: '600' },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unread: { borderColor: colors.accent },
  title: { color: colors.textPrimary, fontWeight: '600' },
  sub: { color: colors.textSecondary, marginTop: 4, fontSize: 13 },
  time: { color: colors.mute, marginTop: 4, fontSize: 11 },
  empty: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  emptySub: { color: colors.textSecondary, textAlign: 'center', marginTop: 8 },
});
