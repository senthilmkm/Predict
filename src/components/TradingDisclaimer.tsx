import React, { useState } from 'react';
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
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  testID?: string;
};

/** Shared trading / liability disclaimer for Paywall, Settings, Home. */
export function TradingDisclaimer({
  variant = 'short',
  showTitle = true,
  showTermsLink = true,
  collapsible = false,
  defaultCollapsed = false,
  testID = 'trading-disclaimer',
}: Props) {
  const [collapsed, setCollapsed] = useState(collapsible ? defaultCollapsed : false);
  const pricing = getPricingConfig();
  const termsUrl = pricing.urls.terms;
  const disclaimerUrl = pricing.urls.disclaimer || termsUrl;

  return (
    <View style={styles.wrap} testID={testID}>
      {collapsible ? (
        <Pressable
          style={styles.headerPressable}
          onPress={() => setCollapsed((c) => !c)}
          testID={`${testID}-toggle`}
        >
          <Text style={styles.title}>{DISCLAIMER_TITLE}</Text>
          <Text style={styles.chevron}>{collapsed ? '▼ Show' : '▲ Hide'}</Text>
        </Pressable>
      ) : showTitle ? (
        <Text style={styles.title}>{DISCLAIMER_TITLE}</Text>
      ) : null}

      {!collapsed ? (
        <>
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
        </>
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
  headerPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chevron: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: '700',
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
