import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { useRuntimeStore } from '../state/runtimeStore';
import { SupportContactFooter } from '../components/SupportContactFooter';
import { formatChange24h, formatChangeWindowLabel } from '../util/moneyFormat';
import {
  formatAssetPayLine,
  formatDayPayFooter,
  formatSignedUsd,
} from '../storage/assetPnlToday';

export function DashboardScreen({ navigation }: { navigation?: any }) {
  const stats = useRuntimeStore((s) => s.stats);
  const assetPnlToday = useRuntimeStore((s) => s.assetPnlToday);
  const change24hUsd = useRuntimeStore((s) => s.change24hUsd);
  const change24hPct = useRuntimeStore((s) => s.change24hPct);
  const change24hWindowMs = useRuntimeStore((s) => s.change24hWindowMs);
  const unread = useRuntimeStore((s) => s.unread);
  const trades = useRuntimeStore((s) => s.trades);
  const alerts = useRuntimeStore((s) => s.alerts);
  const tickOnce = useRuntimeStore((s) => s.tickOnce);
  const refreshCloudSnapshot = useRuntimeStore((s) => s.refreshCloudSnapshot);
  const refreshPredictionsBalance = useRuntimeStore((s) => s.refreshPredictionsBalance);
  const [refreshing, setRefreshing] = useState(false);
  const assetFooter = formatDayPayFooter(assetPnlToday);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshCloudSnapshot(), refreshPredictionsBalance()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshCloudSnapshot, refreshPredictionsBalance]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="screen-dashboard"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
    >
      <Text style={styles.heading}>Kalshi account</Text>
      <Card
        label={formatChangeWindowLabel(change24hWindowMs, change24hUsd)}
        value={formatChange24h(change24hUsd, change24hPct)}
        color={change24hUsd == null ? undefined : change24hUsd >= 0 ? colors.win : colors.loss}
      />
      <Text style={[styles.heading, { marginTop: 10 }]}>Predict trades today (ET)</Text>
      <Card label="Win rate" value={stats.win_rate == null ? '—' : `${(stats.win_rate * 100).toFixed(0)}%`} />
      <Card
        label="Closed P&L (Predict orders)"
        value={`$${stats.realized_pnl_usd.toFixed(2)}`}
        color={stats.realized_pnl_usd >= 0 ? colors.win : colors.loss}
      />
      <Pressable
        testID="btn-dashboard-trades"
        onPress={() => {
          void tickOnce().catch(() => null);
          navigation?.navigate?.('History');
        }}
      >
        <Card label="Trades" value={`${stats.wins}W / ${stats.losses}L`} />
      </Pressable>
      {assetPnlToday.rows.length > 0 ? (
        <View style={styles.card} testID="dashboard-asset-pnl">
          <Text style={styles.label}>Closed P&L by asset</Text>
          {assetPnlToday.rows.map((row) => {
            const payLine = formatAssetPayLine(row);
            return (
              <Pressable
                key={row.asset}
                testID={`dashboard-asset-pnl-${row.asset}`}
                onPress={() => {
                  void tickOnce().catch(() => null);
                  navigation?.navigate?.('History');
                }}
                style={styles.assetRow}
              >
                <View style={styles.assetTop}>
                  <Text style={styles.assetName}>{row.asset}</Text>
                  <Text style={styles.assetWl}>
                    {row.wins}W / {row.losses}L
                  </Text>
                  <Text
                    style={[
                      styles.assetPnl,
                      { color: row.realized_pnl_usd >= 0 ? colors.win : colors.loss },
                    ]}
                  >
                    {formatSignedUsd(row.realized_pnl_usd)}
                  </Text>
                </View>
                {payLine ? <Text style={styles.assetPay}>{payLine}</Text> : null}
              </Pressable>
            );
          })}
          {assetFooter ? (
            <Text style={styles.assetFooter} testID="dashboard-asset-pnl-footer">
              {assetFooter}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Card label="Pending fills" value={String(stats.pending)} />
      <Card label="IOC misses" value={String(stats.misses)} />
      <Card label="Alerts logged" value={String(alerts.length)} />
      <Card label="Unread" value={String(unread)} />
      <Text style={styles.note}>
        Latest trade: {trades[0] ? `${trades[0].asset} ${trades[0].outcome}` : 'none'}
        {trades[0]?.notional_usd != null ? ` · $${trades[0].notional_usd.toFixed(2)}` : ''}
      </Text>
      <Text style={styles.note}>
        Change is your Kalshi Predictions total vs a saved snapshot (24h when we have one,
        otherwise since the first snapshot on this phone). Closed P&L is only Predict orders
        that filled today (ET). The by-asset card uses the same fills and the price you paid
        (not the other side’s quote). History has every fill.
      </Text>
      <SupportContactFooter compact />
    </ScrollView>
  );
}

function Card({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.sm },
  heading: { color: colors.gold, fontWeight: '800', fontSize: 16, marginBottom: 4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { color: colors.textSecondary },
  value: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginTop: 3 },
  assetRow: { marginTop: spacing.sm },
  assetTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  assetName: { color: colors.textPrimary, fontWeight: '700', flex: 1 },
  assetWl: { color: colors.textSecondary, fontSize: 13 },
  assetPnl: { fontSize: 15, fontWeight: '700', minWidth: 72, textAlign: 'right' },
  assetPay: { color: colors.mute, fontSize: 12, marginTop: 2, lineHeight: 16 },
  assetFooter: { color: colors.mute, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
  note: { color: colors.mute, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
});
