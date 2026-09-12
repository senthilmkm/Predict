import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/tokens';

export function PathInfoIcon({
  title,
  body,
  testID,
}: {
  title: string;
  body: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title} info`}
      hitSlop={8}
      onPress={() => Alert.alert(title, body)}
      style={styles.hit}
    >
      <View style={styles.circle}>
        <Text style={styles.i}>i</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { marginLeft: 6 },
  circle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  i: { color: colors.gold, fontSize: 11, fontWeight: '800', lineHeight: 13 },
});
