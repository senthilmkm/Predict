import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { colors } from '../theme/tokens';

export type ManualSuccessFlyProps = {
  text: string;
  startX: number;
  startY: number;
  onDone: () => void;
};

/** Gold success chip that travels from the Buy/Sell button toward the top of Home. */
export function ManualSuccessFly({ text, startX, startY, onDone }: ManualSuccessFlyProps) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const done = useRef(false);

  useEffect(() => {
    const travel = Math.max(72, startY - 28);
    const anim = Animated.parallel([
      Animated.timing(translateY, {
        toValue: -travel,
        duration: 1100,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(650),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 450,
          useNativeDriver: true,
        }),
      ]),
    ]);
    anim.start(({ finished }) => {
      if (!finished || done.current) return;
      done.current = true;
      onDone();
    });
    return () => {
      anim.stop();
    };
  }, [onDone, opacity, startY, translateY]);

  return (
    <Animated.View
      pointerEvents="none"
      testID="manual-success-fly"
      style={[
        styles.chip,
        {
          left: Math.max(8, startX),
          top: startY,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <Text style={styles.text} testID="manual-success-fly-text">
        {text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    zIndex: 50,
    backgroundColor: 'rgba(198, 167, 94, 0.95)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    maxWidth: 220,
  },
  text: {
    color: '#0F1419',
    fontWeight: '800',
    fontSize: 13,
  },
});
