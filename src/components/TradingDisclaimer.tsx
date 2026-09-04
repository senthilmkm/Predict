import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/tokens';
import {
  DISCLAIMER_LONG,
  DISCLAIMER_SHORT,
  DISCLAIMER_TITLE,
} from '../config/disclaimers';
import { getPricingConfig } from '../config/pricing';

type Props = {
  /** short = one paragraph; long = full multi-paragraph. */
  variant?: 'short' | 'long';
  showTitle?: boolean;
  showTermsLink?: boolean;
  testID?: string;
};

/** Shared trading / liability disclaimer for Paywall, Settings, Home. */
export function TradingDisclaimer({
  variant = 'short',
  showTitle = true,
  showTermsLink = true,
  testID = 'trading-disclaimer',
}: Props) {
  const pricing = getPricingConfig();
  const termsUrl = pricing.urls.terms;
  const disclaimerUrl = pricing.urls.disclaimer || termsUrl;

  return (
    <View style={styles.wrap} testID={testID}>
      {showTitle ? <Text style={styles.title}>{DISCLAIMER_TITLE}</Text> : null}
      <Text style={styles.body} testID={`${testID}-body`}>
        {variant === 'long' ? DISCLAIMER_LONG : DISCLAIMER_SHORT}
      </Text>
      {showTermsLink ? (
        <View style={styles.links}>
          <Pressable
            testID={`${testID}-terms`}
            onPress={() => void Linking.openURL(termsUrl)}
            hitSlop={8}
          >
            <Text style={styles.link}>Terms of Use</Text>
          </Pressable>
          <Text style={styles.dot}>·</Text>
          <Pressable
            testID={`${testID}-full`}
            onPress={() => void Linking.openURL(disclaimerUrl)}
            hitSlop={8}
          >
            <Text style={styles.link}>Full disclaimer</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: 'rgba(198, 167, 94, 0.08)',
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  title: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  body: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  links: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  link: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  dot: { color: colors.mute, fontSize: 12 },
});
