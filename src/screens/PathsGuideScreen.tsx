import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { PATH_INFO } from '../content/pathInfo';
import { PATH_TILES } from '../content/pathCatalog';

const COMPARE: { path: string; buys: string; exits: string; hold: string; cushion: string }[] = [
  { path: 'Home Buy', buys: 'The lean you tap', exits: 'You Sell, or Protect if On', hold: 'Unless you sell', cushion: 'Yes' },
  { path: 'Auto-trade', buys: 'Cushion lean', exits: 'Protect if On, else settle', hold: 'Unless Protect', cushion: 'Yes, full' },
  { path: 'Cash out', buys: 'Lean, cheaper entry', exits: 'Target bid, stop, thin bid', hold: 'Tries to sell', cushion: 'Enter %' },
  { path: 'Gold fade', buys: 'Cheap Gold side', exits: 'Take, stop, flatten', hold: 'Always dumps', cushion: 'On/Off only' },
  { path: 'TWAP lock', buys: 'BTC/ETH Yes lock', exits: 'None — hold to $1', hold: 'Yes', cushion: 'On/Off only' },
  { path: 'Last-minute', buys: 'Expensive favorite', exits: 'Hold, or flip if you set it', hold: 'Yes if flip Off', cushion: 'On/Off only' },
  { path: 'Step buy', buys: 'Lean, then add lots', exits: 'Per-lot stop', hold: 'Unless stop', cushion: 'Cushion %' },
  { path: 'Spike fade', buys: 'Always cheap side', exits: 'Take, stop, flatten', hold: 'Always dumps', cushion: 'On/Off only' },
  { path: 'Pair lock', buys: 'Runner + opposite hedge', exits: 'Hold both, or flatten unmatched', hold: 'Locked pair yes', cushion: 'On/Off only' },
];

const GUIDE_KEYS = [
  'shared',
  'home',
  'auto',
  'cashOut',
  'goldFade',
  'twapLock',
  'lastMinute',
  'stepBuy',
  'spikeFade',
  'pairLock',
] as const;

export function PathsGuideScreen() {
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="screen-paths-guide"
    >
      <Text style={styles.kicker}>How paths work</Text>
      <Text style={styles.lead}>
        Each path is a separate way Cloud can buy. Shared limits still apply. Empty chips mean no
        buys on that path. Admin-off paths stay hidden.
      </Text>

      {GUIDE_KEYS.map((key) => {
        const tile = PATH_TILES.find((t) => t.id === key);
        const info = PATH_INFO[key];
        return (
          <View key={key} style={styles.card} testID={`guide-card-${key}`}>
            <Text style={styles.cardTitle}>{tile?.title || info.title}</Text>
            {tile ? <Text style={styles.cardSub}>{tile.sub}</Text> : null}
            <Text style={styles.cardBody}>{info.body}</Text>
          </View>
        );
      })}

      <Text style={styles.kicker}>Compare</Text>
      {COMPARE.map((row) => (
        <View key={row.path} style={styles.compare} testID={`guide-compare-${row.path}`}>
          <Text style={styles.compareTitle}>{row.path}</Text>
          <Text style={styles.compareLine}>Buys · {row.buys}</Text>
          <Text style={styles.compareLine}>Exit · {row.exits}</Text>
          <Text style={styles.compareLine}>Hold to $1 · {row.hold}</Text>
          <Text style={styles.compareLine}>Cushions $ · {row.cushion}</Text>
        </View>
      ))}

      <Text style={styles.foot}>
        Same facts as the Paths guide on the web. Knobs stay in Settings → Paths. This screen never
        places an order.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 40, gap: 10 },
  kicker: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  lead: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  cardTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  cardSub: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  cardBody: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
  compare: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
    gap: 2,
  },
  compareTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 14, marginBottom: 2 },
  compareLine: { color: colors.mute, fontSize: 12, lineHeight: 17 },
  foot: { color: colors.mute, fontSize: 11, lineHeight: 16, marginTop: 8 },
});
