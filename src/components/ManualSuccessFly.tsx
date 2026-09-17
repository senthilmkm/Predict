import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

export type ManualTradeFlyTone = 'success' | 'error';

export type ManualTradeFlyProps = {
  text: string;
  startX: number;
  startY: number;
  tone?: ManualTradeFlyTone;
  onDone: () => void;
};

/** Non-blocking chip from the Buy/Sell button — never steals taps (no OK alert). */
export function ManualSuccessFly({
  text,
  startX,
  startY,
  tone = 'success',
  onDone,
}: ManualTradeFlyProps) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const done = useRef(false);
  const isError = tone === 'error';

  useEffect(() => {
    const travel = Math.max(72, startY - 28);
    const anim = Animated.parallel([
      Animated.timing(translateY, {
        toValue: -travel,
        duration: isError ? 900 : 1100,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(isError ? 500 : 650),
        Animated.timing(opacity, {
          toValue: 0,
          duration: isError ? 380 : 450,
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
  }, [isError, onDone, opacity, startY, translateY]);

  return (
    <Animated.View
      pointerEvents="none"
      testID={isError ? 'manual-error-fly' : 'manual-success-fly'}
      style={[
        styles.chip,
        isError ? styles.chipError : styles.chipSuccess,
        {
          left: Math.max(8, startX - 20),
          top: startY,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <Text
        style={[styles.text, isError ? styles.textError : styles.textSuccess]}
        testID={isError ? 'manual-error-fly-text' : 'manual-success-fly-text'}
        numberOfLines={2}
      >
        {text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    zIndex: 50,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    maxWidth: 240,
  },
  chipSuccess: {
    backgroundColor: 'rgba(198, 167, 94, 0.95)',
  },
  chipError: {
    backgroundColor: 'rgba(232, 93, 93, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  text: {
    fontWeight: '800',
    fontSize: 13,
  },
  textSuccess: {
    color: '#0F1419',
  },
  textError: {
    color: '#FFFFFF',
  },
});
