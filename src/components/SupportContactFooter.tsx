import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import {
  mailtoSupportUrl,
  supportContactEmail,
  supportContactLine,
} from '../config/appMeta';

/** Renders support email from root config.json; taps open mailto. */
export function SupportContactFooter({
  testID = 'support-contact',
  compact = false,
}: {
  testID?: string;
  compact?: boolean;
}) {
  const email = supportContactEmail();
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]} testID={testID}>
      {!compact ? (
        <Text style={styles.hint}>Questions or errors? Contact support:</Text>
      ) : null}
      <Pressable
        testID={`${testID}-email`}
        onPress={() => void Linking.openURL(mailtoSupportUrl('Predict app help'))}
        accessibilityRole="link"
        accessibilityLabel={`Email support ${email}`}
        hitSlop={8}
      >
        <Text style={styles.email}>{supportContactLine()}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    gap: 4,
  },
  wrapCompact: {
    marginTop: 6,
    paddingTop: 0,
  },
  hint: { color: colors.mute, fontSize: 11, lineHeight: 15 },
  email: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
