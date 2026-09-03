import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { AssetKey, CUSHION_BOUNDS } from '../config/types';
import { colors, spacing } from '../theme/tokens';
import { useConfigStore } from '../state/configStore';

const ASSETS: AssetKey[] = ['WTI', 'Gold', 'Silver', 'BTC', 'ETH'];

export function CushionsScreen() {
  const cushions = useConfigStore((s) => s.config.cushions);
  const enabled = useConfigStore((s) => s.config.assets_enabled);
  const setCushion = useConfigStore((s) => s.setCushion);
  const setAssetEnabled = useConfigStore((s) => s.setAssetEnabled);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="screen-cushions">
      <Text style={styles.intro}>
        Static $ cushions — trade only when gap clears the buffer. Drag to adjust; saves
        automatically.
      </Text>
      {ASSETS.map((a) => {
        const b = CUSHION_BOUNDS[a];
        return (
          <View key={a} style={styles.card} testID={`cushion-card-${a}`}>
            <View style={styles.header}>
              <View>
                <Text style={styles.asset}>{a === 'WTI' ? 'Oil (WTI)' : a}</Text>
                <Text style={styles.cushion} testID={`cushion-value-${a}`}>
                  ${cushions[a]}
                </Text>
              </View>
              <Switch
                testID={`cushion-enable-${a}`}
                value={enabled[a]}
                onValueChange={(v) => setAssetEnabled(a, v)}
                trackColor={{ true: colors.accent, false: colors.mute }}
              />
            </View>
            <Slider
              testID={`cushion-slider-${a}`}
              minimumValue={b.min}
              maximumValue={b.max}
              step={b.step}
              value={cushions[a]}
              onValueChange={(v) => setCushion(a, v)}
              minimumTrackTintColor={colors.accent}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.gold}
            />
            <View style={styles.bounds}>
              <Text style={styles.bound}>${b.min}</Text>
              <Text style={styles.bound}>${b.max}</Text>
            </View>
            <View style={styles.nudge}>
              <Pressable
                testID={`cushion-dec-${a}`}
                style={styles.chip}
                onPress={() => setCushion(a, cushions[a] - b.step)}
              >
                <Text style={styles.chipText}>-{b.step}</Text>
              </Pressable>
              <Pressable
                testID={`cushion-inc-${a}`}
                style={styles.chip}
                onPress={() => setCushion(a, cushions[a] + b.step)}
              >
                <Text style={styles.chipText}>+{b.step}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
  intro: { color: colors.textSecondary, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
    borderColor: colors.border,
    borderWidth: 1,
    gap: 6,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  asset: { color: colors.textPrimary, fontSize: 17, fontWeight: '600' },
  cushion: { color: colors.accent, fontSize: 22, fontWeight: '700', marginTop: 2 },
  bounds: { flexDirection: 'row', justifyContent: 'space-between' },
  bound: { color: colors.mute, fontSize: 11 },
  nudge: { flexDirection: 'row', gap: 8, marginTop: 4 },
  chip: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { color: colors.textPrimary, fontSize: 12 },
});
