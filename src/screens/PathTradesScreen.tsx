import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { useRuntimeStore } from '../state/runtimeStore';
import { entryPathChipLabel, formatHistoryTradeSubline, formatSignedUsd } from '../history/tradeDisplay';
import { entryPathsForFocus, PathFocusId, pathTileById } from '../content/pathCatalog';
import { parseEntryPath } from '../storage/repos';

export function PathTradesScreen({
  focus: focusProp,
  route,
}: {
  focus?: PathFocusId;
  route?: { params?: { focus?: PathFocusId } };
}) {
  const focusId = route?.params?.focus ?? focusProp;
  const paths = focusId ? entryPathsForFocus(focusId) : null;
  const title = focusId ? pathTileById(focusId).title : 'Path';
  const trades = useRuntimeStore((s) => s.trades);

  const rows = useMemo(() => {
    if (!paths || paths.length === 0) return [];
    const allow = new Set(paths);
    return trades
      .filter((t) => {
        const p = parseEntryPath(t.entry_path);
        return p != null && allow.has(p);
      })
      .slice()
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  }, [trades, paths]);

  if (paths == null) {
    return (
      <View style={styles.root} testID="screen-path-trades">
        <Text style={styles.empty} testID="path-trades-empty">
          Shared limits has no fills of its own.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="screen-path-trades">
      <Text style={styles.count} testID="path-trades-count">
        {rows.length} {title} trade{rows.length === 1 ? '' : 's'}
      </Text>
      {rows.length === 0 ? (
        <Text style={styles.empty} testID="path-trades-empty">
          No {title} fills yet.
        </Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(i, index) => (i?.id ? String(i.id) : `path-trade-${index}`)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const pathLabel = entryPathChipLabel(item.entry_path);
            const pnl = Number(item.pnl_usd);
            return (
              <View style={styles.row} testID={`path-trade-row-${item.id}`}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>
                    {item.asset} {item.side} · {item.outcome}
                  </Text>
                  {pathLabel ? <Text style={styles.chip}>{pathLabel}</Text> : null}
                </View>
                <Text style={styles.sub}>{formatHistoryTradeSubline(item)}</Text>
                {Number.isFinite(pnl) ? (
                  <Text
                    style={[styles.pnl, { color: pnl >= 0 ? colors.win : colors.loss }]}
                    testID={`path-trade-pnl-${item.id}`}
                  >
                    {formatSignedUsd(pnl)}
                  </Text>
                ) : null}
                <Text style={styles.time}>{formatWhen(item.at)}</Text>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  count: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: spacing.sm },
  empty: { color: colors.mute, fontSize: 14, marginTop: spacing.lg, lineHeight: 20 },
  list: { paddingBottom: spacing.xl, gap: 8 },
  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    gap: 4,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  title: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  chip: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  sub: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  pnl: { fontSize: 13, fontWeight: '700' },
  time: { color: colors.mute, fontSize: 11, marginTop: 2 },
});
