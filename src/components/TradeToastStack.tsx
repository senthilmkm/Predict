import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { TradeGlyph } from './TradeActionOrb';

export type TradeToastAction = 'buy' | 'sell';

export type TradeToastItem = {
  id: string;
  action: TradeToastAction;
  asset: string;
  side?: 'YES' | 'NO' | null;
  pathLabel?: string | null;
};

const MAX_STACK = 3;
const HOLD_MS = typeof process !== 'undefined' && process.env.JEST_WORKER_ID != null ? 40 : 2800;

export function TradeToastStack({
  items,
  onDismiss,
}: {
  items: TradeToastItem[];
  onDismiss: (id: string) => void;
}) {
  const visible = items.slice(0, MAX_STACK);
  if (visible.length === 0) return null;
  return (
    <View style={styles.stack} pointerEvents="none" testID="trade-toast-stack">
      {visible.map((item) => (
        <TradeToastChip key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </View>
  );
}

function TradeToastChip({
  item,
  onDismiss,
}: {
  item: TradeToastItem;
  onDismiss: (id: string) => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;
  const done = useRef(false);
  const isBuy = item.action === 'buy';

  useEffect(() => {
    const anim = Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]),
      Animated.delay(HOLD_MS),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -6, duration: 280, useNativeDriver: true }),
      ]),
    ]);
    anim.start(({ finished }) => {
      if (!finished || done.current) return;
      done.current = true;
      onDismiss(item.id);
    });
    return () => anim.stop();
  }, [item.id, onDismiss, opacity, translateY]);

  return (
    <Animated.View
      testID={`trade-toast-${item.id}`}
      style={[
        styles.chip,
        isBuy ? styles.chipBuy : styles.chipSell,
        { opacity, transform: [{ translateY }] },
      ]}
    >
      <View
        style={[styles.orb, isBuy ? styles.orbBuy : styles.orbSell]}
        testID={`trade-toast-icon-${item.action}-${item.asset}`}
      >
        <TradeGlyph
          glyph={isBuy ? 'plus' : 'minus'}
          color={isBuy ? '#FFFFFF' : '#1A160C'}
          size={12}
        />
      </View>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text style={styles.asset} testID={`trade-toast-asset-${item.asset}`}>
            {item.asset}
          </Text>
          {item.side === 'YES' || item.side === 'NO' ? (
            <Text style={styles.side}>{item.side}</Text>
          ) : null}
        </View>
        {item.pathLabel ? <Text style={styles.path}>{item.pathLabel}</Text> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    zIndex: 60,
    gap: 8,
    alignItems: 'flex-end',
    maxWidth: '72%',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 108,
  },
  chipBuy: {
    backgroundColor: colors.surfaceElevated,
    borderColor: 'rgba(61, 220, 151, 0.35)',
  },
  chipSell: {
    backgroundColor: colors.surfaceElevated,
    borderColor: 'rgba(255, 171, 0, 0.4)',
  },
  orb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbBuy: { backgroundColor: colors.win },
  orbSell: { backgroundColor: colors.warn },
  copy: { flexShrink: 1, gap: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  asset: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  side: { color: colors.mute, fontSize: 11, fontWeight: '700' },
  path: { color: colors.mute, fontSize: 10, fontWeight: '600' },
});
