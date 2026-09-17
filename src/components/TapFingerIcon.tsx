import React from 'react';
import { StyleSheet, View } from 'react-native';

/** Home Buy tap-finger glyph (#8). Color drives active (white) vs idle (gray). */
export function TapFingerIcon({
  color,
  size = 18,
  testID,
}: {
  color: string;
  size?: number;
  testID?: string;
}) {
  const fingerW = size * 0.28;
  const fingerH = size * 0.58;
  const palmW = size * 0.62;
  const palmH = size * 0.4;
  return (
    <View
      testID={testID}
      style={[styles.root, { width: size, height: size }]}
      pointerEvents="none"
    >
      <View
        style={[
          styles.finger,
          {
            width: fingerW,
            height: fingerH,
            borderRadius: fingerW / 2,
            backgroundColor: color,
            left: (size - fingerW) / 2,
            top: size * 0.02,
          },
        ]}
      />
      <View
        style={[
          styles.palm,
          {
            width: palmW,
            height: palmH,
            borderRadius: size * 0.14,
            backgroundColor: color,
            left: (size - palmW) / 2,
            bottom: 0,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative' },
  finger: { position: 'absolute' },
  palm: { position: 'absolute' },
});
