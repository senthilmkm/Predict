import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { useRuntimeStore } from '../state/runtimeStore';
import { SupportContactFooter } from '../components/SupportContactFooter';

export function DashboardScreen({ navigation }: { navigation?: any }) {
  const stats = useRuntimeStore((s) => s.stats);
  const unread = useRuntimeStore((s) => s.unread);
  const trades = useRuntimeStore((s) => s.trades);
  const alerts = useRuntimeStore((s) => s.alerts);
  const tickOnce = useRuntimeStore((s) => s.tickOnce);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="screen-dashboard">
      <Text style={styles.heading}>Today (ET)</Text>
      <Card label="Win rate" value={stats.win_rate == null ? '—' : `${(stats.win_rate * 100).toFixed(0)}%`} />
      <Card
        label="Realized P&L"
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
      <Card label="Pending fills" value={String(stats.pending)} />
      <Card label="IOC misses" value={String(stats.misses)} />
      <Card label="Alerts logged" value={String(alerts.length)} />
      <Card label="Unread" value={String(unread)} />
      <Text style={styles.note}>
        Latest trade: {trades[0] ? `${trades[0].asset} ${trades[0].outcome}` : 'none'}
        {trades[0]?.notional_usd != null ? ` · $${trades[0].notional_usd.toFixed(2)}` : ''}
      </Text>
      <Text style={styles.note}>
        Snapshot = today America/New_York only. History tab has full lists + filters.
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
  note: { color: colors.mute, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
});
