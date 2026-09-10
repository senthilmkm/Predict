import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { useConfigStore } from '../state/configStore';
import { useRuntimeStore } from '../state/runtimeStore';
import { AssetKey } from '../config/types';
import { LeanResult } from '../services/lean/lean';
import { TradeRecord } from '../storage/repos';
import { useMarkAlertsSeenOnLeave } from '../hooks/useMarkAlertsSeenOnLeave';
import {
  ALERT_FILTERS,
  AlertFilter,
  DEFAULT_TRADE_FILTERS,
  TRADE_SIDE_FILTERS,
  TRADE_STATUS_FILTERS,
  TradeAssetFilter,
  TradeFilterSelection,
  TradeSideFilter,
  TradeStatusFilter,
  alertFilterLabel,
  filterAlerts,
  filterTrades,
  tradeAssetFilterOptions,
  tradeSideFilterLabel,
  tradeStatusFilterLabel,
} from '../history/filters';

export function computeTradeStatusDot(
  trade: TradeRecord,
  lean?: LeanResult | null,
  cushionUsd?: number
): { color: string; statusLabel: string; testIDColor: string } {
  // Settled Trades
  if (trade.outcome === 'win') {
    return { color: '#22c55e', statusLabel: 'Favorable (Settled Win)', testIDColor: 'green' };
  }
  if (trade.outcome === 'loss') {
    return { color: '#ef4444', statusLabel: 'Unfavorable (Settled Loss)', testIDColor: 'red' };
  }
  if (trade.outcome === 'miss') {
    return { color: '#6b7280', statusLabel: 'IOC Miss (No fill)', testIDColor: 'gray' };
  }

  // Active / Pending Trades
  if (
    !lean ||
    lean.live == null ||
    lean.strike == null ||
    !Number.isFinite(lean.live) ||
    !Number.isFinite(lean.strike)
  ) {
    return { color: '#eab308', statusLabel: 'Pending (Live check…)', testIDColor: 'yellow' };
  }

  const live = Number(lean.live);
  const strike = Number(lean.strike);
  const cushion = Math.max(0, Number(cushionUsd) || 0);

  const diff = trade.side === 'YES' ? live - strike : strike - live;

  if (diff >= cushion - 1e-9) {
    return { color: '#22c55e', statusLabel: 'Favorable (ITM ≥ Cushion)', testIDColor: 'green' };
  }
  if (diff >= -1e-9) {
    return { color: '#eab308', statusLabel: 'At Border (ITM < Cushion)', testIDColor: 'yellow' };
  }
  return { color: '#ef4444', statusLabel: 'Unfavorable (OTM)', testIDColor: 'red' };
}

function moneyUsd(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : '—';
}

function formatWhen(at: unknown): string {
  const d = new Date(String(at || ''));
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : '—';
}

type OpenTradeMenu = 'status' | 'side' | 'asset' | null;

export function HistoryScreen() {
  const [tab, setTab] = useState<'trades' | 'alerts'>('trades');
  const [alertFilter, setAlertFilter] = useState<AlertFilter>('all');
  const [tradeFilters, setTradeFilters] = useState<TradeFilterSelection>(DEFAULT_TRADE_FILTERS);
  const [openTradeMenu, setOpenTradeMenu] = useState<OpenTradeMenu>(null);
  const cushions = useConfigStore((s) => s.config.cushions);
  const tradesRaw = useRuntimeStore((s) => s.trades);
  const leans = useRuntimeStore((s) => s.leans);
  const alertsRaw = useRuntimeStore((s) => s.alerts);
  const refreshCloudSnapshot = useRuntimeStore((s) => s.refreshCloudSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  useMarkAlertsSeenOnLeave(tab === 'alerts');

  const trades = Array.isArray(tradesRaw) ? tradesRaw : [];
  const alerts = Array.isArray(alertsRaw) ? alertsRaw : [];

  useEffect(() => {
    void Promise.resolve()
      .then(() => refreshCloudSnapshot())
      .catch(() => {
        /* Keep last trades/alerts if Cloud/Firestore is down */
      });
  }, [refreshCloudSnapshot]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshCloudSnapshot();
    } catch {
      /* Keep last known History if the snapshot fails */
    } finally {
      setRefreshing(false);
    }
  }, [refreshCloudSnapshot]);

  const filteredTrades = useMemo(() => filterTrades(trades, tradeFilters), [trades, tradeFilters]);
  const filteredAlerts = useMemo(() => filterAlerts(alerts, alertFilter), [alerts, alertFilter]);
  const assetOptions = useMemo(() => tradeAssetFilterOptions(trades), [trades]);

  const statusLabel = tradeStatusFilterLabel(tradeFilters.status);
  const sideLabel = tradeSideFilterLabel(tradeFilters.side);
  const assetLabel =
    tradeFilters.asset === 'all'
      ? 'All'
      : assetOptions.find((o) => o.id === tradeFilters.asset)?.label || tradeFilters.asset;

  const closeTradeMenu = useCallback(() => setOpenTradeMenu(null), []);

  return (
    <View style={styles.root} testID="screen-history">
      <View style={styles.seg}>
        <Seg
          testID="seg-trades"
          label="Trades"
          active={tab === 'trades'}
          onPress={() => {
            closeTradeMenu();
            setTab('trades');
          }}
        />
        <Seg
          testID="seg-alerts"
          label="Alerts"
          active={tab === 'alerts'}
          onPress={() => {
            closeTradeMenu();
            setTab('alerts');
          }}
        />
      </View>

      {tab === 'trades' ? (
        <>
          <View testID="history-trade-filters">
            <View style={styles.filterBar}>
              <FilterDropdown
                testID="trade-filter-status"
                caption="Status"
                value={statusLabel}
                open={openTradeMenu === 'status'}
                onPress={() => setOpenTradeMenu((m) => (m === 'status' ? null : 'status'))}
              />
              <FilterDropdown
                testID="trade-filter-side"
                caption="Side"
                value={sideLabel}
                open={openTradeMenu === 'side'}
                onPress={() => setOpenTradeMenu((m) => (m === 'side' ? null : 'side'))}
              />
              <FilterDropdown
                testID="trade-filter-asset"
                caption="Asset"
                value={assetLabel}
                open={openTradeMenu === 'asset'}
                onPress={() => setOpenTradeMenu((m) => (m === 'asset' ? null : 'asset'))}
              />
            </View>
            {openTradeMenu === 'status' ? (
              <OptionMenu
                testID="trade-filter-status-menu"
                options={TRADE_STATUS_FILTERS}
                selected={tradeFilters.status}
                optionTestID={(id) => `trade-filter-status-option-${id}`}
                onSelect={(id) => {
                  setTradeFilters((prev) => ({ ...prev, status: id as TradeStatusFilter }));
                  closeTradeMenu();
                }}
              />
            ) : null}
            {openTradeMenu === 'side' ? (
              <OptionMenu
                testID="trade-filter-side-menu"
                options={TRADE_SIDE_FILTERS}
                selected={tradeFilters.side}
                optionTestID={(id) => `trade-filter-side-option-${id}`}
                onSelect={(id) => {
                  setTradeFilters((prev) => ({ ...prev, side: id as TradeSideFilter }));
                  closeTradeMenu();
                }}
              />
            ) : null}
            {openTradeMenu === 'asset' ? (
              <OptionMenu
                testID="trade-filter-asset-menu"
                options={assetOptions}
                selected={tradeFilters.asset}
                optionTestID={(id) => `trade-filter-asset-option-${id}`}
                onSelect={(id) => {
                  setTradeFilters((prev) => ({ ...prev, asset: id as TradeAssetFilter }));
                  closeTradeMenu();
                }}
              />
            ) : null}
          </View>
          <Text style={styles.count} testID="history-trade-count">
            {filteredTrades.length} of {trades.length}
            {tradeFilters.status !== 'all' ? ` · ${statusLabel}` : ''}
            {tradeFilters.side !== 'all' ? ` · ${sideLabel}` : ''}
            {tradeFilters.asset !== 'all' ? ` · ${assetLabel}` : ''}
          </Text>
          {trades.length === 0 ? (
            <Empty text="No trades yet" sub="Filled and pending orders appear here." />
          ) : filteredTrades.length === 0 ? (
            <Empty text="No matching trades" sub="Change Status, Side, or Asset." />
          ) : (
            <FlatList
              data={filteredTrades}
              keyExtractor={(i, index) => (i && i.id ? String(i.id) : `trade-${index}`)}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => void onRefresh()}
                  tintColor={colors.accent}
                  colors={[colors.accent]}
                />
              }
              renderItem={({ item }) => {
                try {
                  const lean = leans[item.asset as AssetKey];
                  const cushion = cushions[item.asset as AssetKey];
                  const statusInfo = computeTradeStatusDot(item, lean, cushion);
                  const fillCount =
                    item.fill_count != null && Number.isFinite(Number(item.fill_count))
                      ? Number(item.fill_count)
                      : null;
                  return (
                    <View style={styles.row} testID={`trade-row-${item.id}`}>
                      <View style={styles.tradeTitleGroup}>
                        <View
                          style={[styles.statusDot, { backgroundColor: statusInfo.color }]}
                          testID={`trade-status-dot-${item.id}-${statusInfo.testIDColor}`}
                          accessibilityLabel={statusInfo.statusLabel}
                        />
                        <Text style={styles.title}>
                          {item.asset} {item.side} · {item.outcome}
                        </Text>
                      </View>
                      <Text style={styles.sub}>
                        {item.market_ticker} · cost ${moneyUsd(item.notional_usd)}
                        {fillCount != null ? ` · ${fillCount} ctr` : ''}
                        {item.pnl_usd != null ? ` · P&L $${moneyUsd(item.pnl_usd)}` : ''}
                      </Text>
                      <Text style={styles.time}>{formatWhen(item.at)}</Text>
                    </View>
                  );
                } catch {
                  return (
                    <View style={styles.row} testID={`trade-row-error-${item?.id || 'unknown'}`}>
                      <Text style={styles.title}>Couldn't display this trade</Text>
                      <Text style={styles.sub}>Skipped a bad row so History can still load.</Text>
                    </View>
                  );
                }
              }}
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
              keyExtractor={(i, index) => (i && i.id ? String(i.id) : `alert-${index}`)}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => void onRefresh()}
                  tintColor={colors.accent}
                  colors={[colors.accent]}
                />
              }
              renderItem={({ item }) => (
                <View style={[styles.row, !item.read && styles.unread]} testID={`alert-row-${item.id}`}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.sub}>{item.body}</Text>
                  <Text style={styles.time}>
                    {alertFilterLabel(item.kind)} · {formatWhen(item.at)}
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

function FilterDropdown({
  caption,
  value,
  open,
  onPress,
  testID,
}: {
  caption: string;
  value: string;
  open: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${caption} ${value}`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={[styles.dropdown, open && styles.dropdownOpen]}
    >
      <Text style={styles.dropdownCaption}>{caption}</Text>
      <Text style={styles.dropdownValue} numberOfLines={1}>
        {value} ▾
      </Text>
    </Pressable>
  );
}

function OptionMenu({
  options,
  selected,
  onSelect,
  testID,
  optionTestID,
}: {
  options: { id: string; label: string }[];
  selected: string;
  onSelect: (id: string) => void;
  testID: string;
  optionTestID: (id: string) => string;
}) {
  return (
    <ScrollView
      testID={testID}
      style={styles.menu}
      contentContainerStyle={styles.menuInner}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
    >
      {options.map((opt) => {
        const on = opt.id === selected;
        return (
          <Pressable
            key={opt.id}
            testID={optionTestID(opt.id)}
            style={[styles.menuItem, on && styles.menuItemOn]}
            onPress={() => onSelect(opt.id)}
          >
            <Text style={[styles.menuItemText, on && styles.menuItemTextOn]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
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
  filterBar: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  dropdown: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  dropdownOpen: { borderColor: colors.accent },
  dropdownCaption: { color: colors.mute, fontSize: 10, fontWeight: '700', marginBottom: 2 },
  dropdownValue: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  menu: {
    maxHeight: 220,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 10,
  },
  menuInner: { paddingVertical: 4 },
  menuItem: { paddingHorizontal: 12, paddingVertical: 10 },
  menuItemOn: { backgroundColor: colors.accent },
  menuItemText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  menuItemTextOn: { color: colors.bg },
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
  tradeTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  title: { color: colors.textPrimary, fontWeight: '600' },
  sub: { color: colors.textSecondary, marginTop: 4, fontSize: 13 },
  time: { color: colors.mute, marginTop: 4, fontSize: 11 },
  empty: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  emptySub: { color: colors.textSecondary, textAlign: 'center', marginTop: 8 },
});

