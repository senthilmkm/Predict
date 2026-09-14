import React, { useEffect, useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { PathInfoIcon } from '../components/PathInfoIcon';
import { PathFocusId, PATH_TILES, PathTileDef } from '../content/pathCatalog';
import { usePinnedPathsStore } from '../state/pinnedPathsStore';
import { useRuntimeStore } from '../state/runtimeStore';
import { useConfigStore } from '../state/configStore';
import { normalizeLastMinuteAssets } from '../../packages/trading-core/src/lastMinute';
import { normalizeStepBuyAssets } from '../../packages/trading-core/src/stepBuy';
import { normalizeSpikeFadeAssets } from '../../packages/trading-core/src/spikeFade';
import { normalizePairLockAssets } from '../../packages/trading-core/src/pairLock';
import { normalizeCheapLoopAssets } from '../../packages/trading-core/src/cheapLoop';
import { normalizeTwapLockAssets } from '../../packages/trading-core/src/twapLock';
import { formatSharedChipOverlapNote } from './tickerOverlap';

const PATHS_HELP =
  'Tap a name to edit only that path. Star pins it on Home (three max). Unpin by starring again. Admin-off paths stay hidden.';

/** Empty overlay above the sheet. Lower = sheet stretches up so Cheap loop is not clipped. */
export const PATHS_PICKER_OVERLAY_PAD_TOP = 24;

export function PathsPickerSheet({
  visible,
  onClose,
  onOpenPath,
  onOpenGuide,
  lift = 0,
}: {
  visible: boolean;
  onClose: () => void;
  onOpenPath: (id: PathFocusId) => void;
  onOpenGuide?: () => void;
  lift?: number;
}) {
  const pinned = usePinnedPathsStore((s) => s.ids);
  const hydrate = usePinnedPathsStore((s) => s.hydrate);
  const togglePin = usePinnedPathsStore((s) => s.toggle);
  const cashOutFeatureOn = useRuntimeStore((s) => s.cashOutFeatureOn);
  const goldFadeFeatureOn = useRuntimeStore((s) => s.goldFadeFeatureOn);
  const twapLockFeatureOn = useRuntimeStore((s) => s.twapLockFeatureOn);
  const lastMinuteFeatureOn = useRuntimeStore((s) => s.lastMinuteFeatureOn);
  const stepBuyFeatureOn = useRuntimeStore((s) => s.stepBuyFeatureOn);
  const spikeFadeFeatureOn = useRuntimeStore((s) => s.spikeFadeFeatureOn);
  const pairLockFeatureOn = useRuntimeStore((s) => s.pairLockFeatureOn);
  const cheapLoopFeatureOn = useRuntimeStore((s) => s.cheapLoopFeatureOn);
  const config = useConfigStore((s) => s.config);
  const { height: windowHeight } = useWindowDimensions();
  const sheetMaxHeight = Math.max(280, windowHeight - lift - PATHS_PICKER_OVERLAY_PAD_TOP);
  const scrollMaxHeight = Math.max(160, sheetMaxHeight - 132);

  useEffect(() => {
    if (visible) void hydrate();
  }, [visible, hydrate]);

  const flags = useMemo(
    () => ({
      cashOutFeatureOn,
      goldFadeFeatureOn,
      twapLockFeatureOn,
      lastMinuteFeatureOn,
      stepBuyFeatureOn,
      spikeFadeFeatureOn,
      pairLockFeatureOn,
      cheapLoopFeatureOn,
    }),
    [
      cashOutFeatureOn,
      goldFadeFeatureOn,
      twapLockFeatureOn,
      lastMinuteFeatureOn,
      stepBuyFeatureOn,
      spikeFadeFeatureOn,
      pairLockFeatureOn,
      cheapLoopFeatureOn,
    ]
  );

  const tiles = PATH_TILES.filter((t) => !t.adminFlag || flags[t.adminFlag]);
  const overlapNote = formatSharedChipOverlapNote(
    [
      twapLockFeatureOn && config.risk.twap_lock_enabled
        ? { title: 'TWAP lock', assets: normalizeTwapLockAssets(config.risk.twap_lock_assets) }
        : null,
      lastMinuteFeatureOn && config.risk.last_minute_enabled
        ? { title: 'Last-minute', assets: normalizeLastMinuteAssets(config.risk.last_minute_assets) }
        : null,
      stepBuyFeatureOn && config.risk.step_buy_enabled
        ? { title: 'Step buy', assets: normalizeStepBuyAssets(config.risk.step_buy_assets) }
        : null,
      spikeFadeFeatureOn && config.risk.spike_fade_enabled
        ? { title: 'Spike fade', assets: normalizeSpikeFadeAssets(config.risk.spike_fade_assets) }
        : null,
      pairLockFeatureOn && config.risk.pair_lock_enabled
        ? { title: 'Pair lock', assets: normalizePairLockAssets(config.risk.pair_lock_assets) }
        : null,
      cheapLoopFeatureOn && config.risk.cheap_loop_enabled
        ? { title: 'Cheap loop', assets: normalizeCheapLoopAssets(config.risk.cheap_loop_assets) }
        : null,
    ].filter(Boolean) as Array<{ title: string; assets: string[] }>
  );

  async function onStar(tile: PathTileDef) {
    const result = await togglePin(tile.id);
    if (!result.ok) {
      Alert.alert('Three pins max', 'Unpin one first, then star this path.');
    }
  }

  if (!visible) return null;

  return (
    <View
      testID="modal-paths-picker"
      style={[styles.overlay, { paddingBottom: lift, paddingTop: PATHS_PICKER_OVERLAY_PAD_TOP }]}
      pointerEvents="auto"
    >
      <Pressable style={styles.scrim} onPress={onClose} testID="paths-picker-scrim" />
      <View style={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
        <View style={styles.grab} />
        <View style={styles.head}>
          <View style={styles.headLeft}>
            <Text style={styles.title}>Paths</Text>
            <PathInfoIcon title="Paths" body={PATHS_HELP} testID="path-info-paths-picker" />
          </View>
          <Pressable onPress={onClose} hitSlop={10} testID="btn-close-paths-picker">
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>
        <Text style={styles.blurb}>Tap a name to edit. ★ pins on Home.</Text>
        {overlapNote ? (
          <Text style={styles.overlap} testID="paths-overlap-note">
            {overlapNote}
          </Text>
        ) : null}
        <ScrollView
          testID="paths-picker-scroll"
          style={[styles.scroll, { maxHeight: scrollMaxHeight }]}
          contentContainerStyle={styles.scrollInner}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator
          bounces
        >
          <View style={styles.grid}>
            {tiles.map((tile, index) => {
              const starred = pinned.includes(tile.id);
              const lastOdd = tiles.length % 2 === 1 && index === tiles.length - 1;
              return (
                <View
                  key={tile.id}
                  testID={`path-tile-wrap-${tile.id}`}
                  style={[styles.tileWrap, lastOdd && styles.tileWrapFull]}
                >
                  <Pressable
                    testID={`path-tile-${tile.id}`}
                    style={styles.tile}
                    onPress={() => onOpenPath(tile.id)}
                    accessibilityLabel={`${tile.title}. ${tile.sub}`}
                  >
                    <Text style={styles.tileTitle} numberOfLines={1}>
                      {tile.title}
                    </Text>
                    <Text style={styles.tileSub} numberOfLines={1}>
                      {tile.sub}
                    </Text>
                  </Pressable>
                  <Pressable
                    testID={`pin-path-${tile.id}`}
                    style={styles.pin}
                    onPress={() => void onStar(tile)}
                    hitSlop={6}
                    accessibilityLabel={starred ? `Unpin ${tile.title}` : `Pin ${tile.title}`}
                  >
                    <Text style={[styles.pinText, starred && styles.pinOn]}>
                      {starred ? '★' : '☆'}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
          {onOpenGuide ? (
            <Pressable testID="btn-paths-guide" style={styles.guideBtn} onPress={onOpenGuide}>
              <Text style={styles.guideText}>How paths work</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: '#151c25',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingBottom: 4,
    paddingTop: 8,
    overflow: 'hidden',
  },
  scroll: { flexGrow: 0 },
  scrollInner: { paddingBottom: 28, flexGrow: 0 },
  grab: {
    width: 36,
    height: 4,
    borderRadius: 99,
    backgroundColor: '#3a4654',
    alignSelf: 'center',
    marginBottom: 8,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headLeft: { flexDirection: 'row', alignItems: 'center' },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  close: { color: colors.accent, fontWeight: '800', fontSize: 14 },
  blurb: { color: colors.mute, fontSize: 12, marginBottom: 8 },
  overlap: { color: colors.warn, fontSize: 11, lineHeight: 15, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tileWrap: { width: '48.5%', position: 'relative' },
  tileWrapFull: { width: '100%' },
  tile: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 8,
    paddingLeft: 10,
    paddingRight: 28,
    minHeight: 46,
  },
  tileTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '700', lineHeight: 16 },
  tileSub: { color: colors.mute, fontSize: 10, marginTop: 2 },
  pin: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinText: { color: colors.mute, fontSize: 14 },
  pinOn: { color: colors.gold },
  guideBtn: {
    marginTop: 10,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
  },
  guideText: { color: colors.accent, fontWeight: '800', fontSize: 13 },
});
