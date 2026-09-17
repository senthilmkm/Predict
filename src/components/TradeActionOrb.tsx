import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/tokens';

export type TradeOrbTone = 'buy' | 'buyDeep' | 'idle' | 'sell';
export type TradeOrbGlyph = 'plus' | 'minus';

const TONE: Record<
  TradeOrbTone,
  { fill: string; rim: string; glyph: string; sheen: string; shadow: string }
> = {
  buy: {
    fill: colors.win,
    rim: 'rgba(255,255,255,0.38)',
    glyph: '#FFFFFF',
    sheen: 'rgba(255,255,255,0.28)',
    shadow: colors.win,
  },
  buyDeep: {
    fill: colors.buyDeep,
    rim: 'rgba(255,255,255,0.28)',
    glyph: '#FFFFFF',
    sheen: 'rgba(255,255,255,0.2)',
    shadow: colors.buyDeep,
  },
  idle: {
    fill: colors.surfaceElevated,
    rim: 'rgba(139,152,165,0.55)',
    glyph: colors.textSecondary,
    sheen: 'rgba(255,255,255,0.06)',
    shadow: '#000',
  },
  sell: {
    fill: colors.warn,
    rim: 'rgba(255,255,255,0.36)',
    glyph: '#1A160C',
    sheen: 'rgba(255,255,255,0.32)',
    shadow: colors.warn,
  },
};

/** Rounded plus / minus for Home trade orbs. */
export function TradeGlyph({
  glyph,
  color,
  size = 18,
  testID,
}: {
  glyph: TradeOrbGlyph;
  color: string;
  size?: number;
  testID?: string;
}) {
  const stroke = Math.max(2.5, Math.round(size * 0.16));
  const arm = size * 0.62;
  return (
    <View
      testID={testID}
      style={{ width: size, height: size, position: 'relative' }}
      pointerEvents="none"
    >
      <View
        style={{
          position: 'absolute',
          left: (size - arm) / 2,
          top: (size - stroke) / 2,
          width: arm,
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
        }}
      />
      {glyph === 'plus' ? (
        <View
          style={{
            position: 'absolute',
            left: (size - stroke) / 2,
            top: (size - arm) / 2,
            width: stroke,
            height: arm,
            borderRadius: stroke / 2,
            backgroundColor: color,
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * Circular Home Buy / Sell control — soft rim, sheen, shadow so it reads as tappable.
 */
export function TradeActionOrb({
  tone,
  glyph,
  size = 44,
  pressed = false,
  badge,
  testID,
  iconTestID,
}: {
  tone: TradeOrbTone;
  glyph: TradeOrbGlyph;
  size?: number;
  pressed?: boolean;
  /** Side label under the glyph (pair Sell YES / NO). */
  badge?: 'YES' | 'NO';
  testID?: string;
  iconTestID?: string;
}) {
  const t = TONE[tone];
  const glyphSize = badge ? Math.round(size * 0.36) : Math.round(size * 0.42);
  const scale = pressed ? 0.92 : 1;
  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={[
        styles.orb,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: t.fill,
          borderColor: t.rim,
          transform: [{ scale }],
          opacity: pressed ? 0.92 : 1,
          ...Platform.select({
            ios: {
              shadowColor: t.shadow,
              shadowOffset: { width: 0, height: pressed ? 1 : 3 },
              shadowOpacity: tone === 'idle' ? 0.28 : 0.45,
              shadowRadius: pressed ? 2 : 6,
            },
            android: { elevation: pressed ? 2 : 5 },
            default: {},
          }),
        },
      ]}
    >
      <View
        style={[
          styles.sheen,
          {
            height: size * 0.42,
            borderTopLeftRadius: size / 2,
            borderTopRightRadius: size / 2,
            backgroundColor: t.sheen,
          },
        ]}
      />
      <View style={styles.glyphWrap}>
        <TradeGlyph glyph={glyph} color={t.glyph} size={glyphSize} testID={iconTestID} />
        {badge ? (
          <Text style={[styles.badge, { color: t.glyph }]} numberOfLines={1}>
            {badge}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  orb: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  glyphWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    zIndex: 1,
  },
  badge: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.4,
    marginTop: -1,
  },
});
