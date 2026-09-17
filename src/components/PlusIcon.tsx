import React from 'react';
import { StyleSheet, View } from 'react-native';

/** Home Buy plus glyph (#3). Color drives active (white) vs idle (gray). */
export function PlusIcon({
  color,
  size = 18,
  testID,
}: {
  color: string;
  size?: number;
  testID?: string;
}) {
  const stroke = Math.max(2, Math.round(size * 0.14));
  const arm = size * 0.55;
  return (
    <View
      testID={testID}
      style={[styles.root, { width: size, height: size }]}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative' },
});
