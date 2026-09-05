import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import {
  ALL_ASSET_CATEGORIES,
  AssetCategory,
  AssetDefinition,
  AssetRegistry,
  CATEGORY_ICONS,
} from '../config/types';
import { colors, spacing } from '../theme/tokens';
import { useConfigStore } from '../state/configStore';

export function CushionsScreen() {
  const cushions = useConfigStore((s) => s.config.cushions);
  const enabled = useConfigStore((s) => s.config.assets_enabled);
  const setCushion = useConfigStore((s) => s.setCushion);
  const setAssetEnabled = useConfigStore((s) => s.setAssetEnabled);
  const [selectedFilter, setSelectedFilter] = useState<AssetCategory | 'All'>('All');

  const categoriesToDisplay =
    selectedFilter === 'All'
      ? ALL_ASSET_CATEGORIES
      : ALL_ASSET_CATEGORIES.filter((c) => c === selectedFilter);

  const toggleCategoryMaster = (cat: AssetCategory, enable: boolean) => {
    const assets = AssetRegistry.getByCategory(cat);
    for (const a of assets) {
      setAssetEnabled(a.key, enable);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="screen-cushions">
      <Text style={styles.intro}>
        Static $ cushions — trade only when gap clears the buffer. Drag to adjust; saves
        automatically.
      </Text>

      {/* Category Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterContainer}
      >
        <Pressable
          testID="filter-chip-all"
          style={[styles.filterChip, selectedFilter === 'All' && styles.filterChipActive]}
          onPress={() => setSelectedFilter('All')}
        >
          <Text style={[styles.filterText, selectedFilter === 'All' && styles.filterTextActive]}>
            All
          </Text>
        </Pressable>
        {ALL_ASSET_CATEGORIES.map((cat) => {
          const active = selectedFilter === cat;
          return (
            <Pressable
              key={cat}
              testID={`filter-chip-${cat.toLowerCase().replace(/\s+/g, '-')}`}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setSelectedFilter(cat)}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {CATEGORY_ICONS[cat]} {cat}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Categories & Assets */}
      {categoriesToDisplay.map((cat) => {
        const catAssets = AssetRegistry.getByCategory(cat);
        const activeCount = catAssets.filter((a) => enabled[a.key]).length;
        const allCatEnabled = catAssets.length > 0 && activeCount === catAssets.length;

        return (
          <View key={cat} style={styles.categorySection} testID={`category-section-${cat.toLowerCase().replace(/\s+/g, '-')}`}>
            {/* Category Header */}
            <View style={styles.categoryHeader}>
              <View style={styles.categoryTitleRow}>
                <Text style={styles.categoryIcon}>{CATEGORY_ICONS[cat]}</Text>
                <Text style={styles.categoryTitle}>{cat}</Text>
                <Text style={styles.categoryBadge}>
                  {catAssets.length > 0 ? `${activeCount}/${catAssets.length} active` : 'Coming soon'}
                </Text>
              </View>
              {catAssets.length > 0 ? (
                <Switch
                  testID={`category-switch-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                  value={allCatEnabled}
                  onValueChange={(v) => toggleCategoryMaster(cat, v)}
                  trackColor={{ true: colors.accent, false: colors.mute }}
                />
              ) : null}
            </View>

            {/* Asset Cards under Category */}
            {catAssets.length === 0 ? (
              <View style={styles.emptyCategoryCard}>
                <Text style={styles.emptyCategoryText}>
                  Additional {cat} 15-minute prediction markets coming soon to Kalshi.
                </Text>
              </View>
            ) : (
              catAssets.map((assetDef: AssetDefinition) => {
                const a = assetDef.key;
                const b = assetDef.cushionBounds;
                const val = cushions[a] ?? assetDef.defaultCushion;
                const isEnabled = enabled[a] ?? true;

                return (
                  <View key={a} style={styles.card} testID={`cushion-card-${a}`}>
                    <View style={styles.header}>
                      <View>
                        <Text style={styles.asset}>
                          {assetDef.name} ({a})
                        </Text>
                        <Text style={styles.cushion} testID={`cushion-value-${a}`}>
                          ${val}
                        </Text>
                      </View>
                      <Switch
                        testID={`cushion-enable-${a}`}
                        value={isEnabled}
                        onValueChange={(v) => setAssetEnabled(a, v)}
                        trackColor={{ true: colors.accent, false: colors.mute }}
                      />
                    </View>
                    <Slider
                      testID={`cushion-slider-${a}`}
                      minimumValue={b.min}
                      maximumValue={b.max}
                      step={b.step}
                      value={val}
                      onValueChange={(v) => setCushion(a, Math.round(v * 100) / 100)}
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
                        onPress={() => setCushion(a, Math.round((val - b.step) * 100) / 100)}
                      >
                        <Text style={styles.chipText}>-{b.step}</Text>
                      </Pressable>
                      <Pressable
                        testID={`cushion-inc-${a}`}
                        style={styles.chip}
                        onPress={() => setCushion(a, Math.round((val + b.step) * 100) / 100)}
                      >
                        <Text style={styles.chipText}>+{b.step}</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: 40 },
  intro: { color: colors.textSecondary, marginBottom: spacing.xs, fontSize: 13 },
  filterScroll: { marginBottom: spacing.xs },
  filterContainer: { gap: spacing.xs, paddingRight: spacing.md },
  filterChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  filterChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  filterText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  filterTextActive: { color: colors.bg, fontWeight: '700' },
  categorySection: { gap: spacing.sm, marginBottom: spacing.xs },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  categoryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  categoryIcon: { fontSize: 16 },
  categoryTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  categoryBadge: { color: colors.textSecondary, fontSize: 12, marginLeft: 4 },
  emptyCategoryCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    borderColor: colors.border,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  emptyCategoryText: { color: colors.textSecondary, fontSize: 12, fontStyle: 'italic' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
    borderColor: colors.border,
    borderWidth: 1,
    gap: 6,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  asset: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
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

