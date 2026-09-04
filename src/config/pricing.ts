/**
 * pricing.json is the single source of truth for paywall copy, trial, promotions,
 * and RevenueCat product / entitlement IDs. No secrets beyond public SDK keys.
 */
import raw from '../../pricing.json';

export type BillingPeriod = 'month' | 'year' | 'week';

export interface FreeTrialConfig {
  enabled: boolean;
  days: number;
  label: string;
  detail: string;
}

export interface PromotionConfig {
  id: string;
  enabled: boolean;
  badge: string;
  title: string;
  subtitle: string;
  accent?: 'gold' | 'accent' | 'warn';
}

export interface PricingConfig {
  version: number;
  app: {
    name: string;
    tagline: string;
    supportEmail: string;
  };
  urls: {
    privacy: string;
    terms: string;
    support: string;
    marketing: string;
    manageSubscriptionsIOS: string;
    /** Optional dedicated risk disclaimer page. */
    disclaimer?: string;
  };
  subscription: {
    enabled: boolean;
    entitlementId: string;
    offeringId: string;
    productId: string;
    displayName: string;
    billingPeriod: BillingPeriod;
    priceUsd: number;
    priceLabel: string;
    periodLabel: string;
    currencyCode: string;
    freeTrial: FreeTrialConfig;
    features: string[];
    paywall: {
      headline: string;
      subheadline: string;
      ctaTrial: string;
      ctaSubscribe: string;
      ctaLoading: string;
      footnote: string;
    };
  };
  promotions: PromotionConfig[];
  revenueCat: {
    iosApiKey: string;
    androidApiKey: string;
    usesStoreKit2: boolean;
  };
  antiAbuse: {
    bindToAppleAccount: boolean;
    requireRestoreOnReinstall: boolean;
    note: string;
  };
}

let cached: PricingConfig | null = null;

export function getPricingConfig(): PricingConfig {
  if (cached) return cached;
  cached = raw as PricingConfig;
  return cached;
}

export function isSubscriptionModelEnabled(): boolean {
  return getPricingConfig().subscription.enabled !== false;
}

export function activePromotions(): PromotionConfig[] {
  return (getPricingConfig().promotions || []).filter((p) => p.enabled);
}

export function primaryCtaLabel(): string {
  const s = getPricingConfig().subscription;
  if (s.freeTrial?.enabled && s.freeTrial.days > 0) return s.paywall.ctaTrial;
  return s.paywall.ctaSubscribe;
}

export function hasUsableRevenueCatKey(platform: 'ios' | 'android'): boolean {
  const key =
    platform === 'ios'
      ? getPricingConfig().revenueCat.iosApiKey
      : getPricingConfig().revenueCat.androidApiKey;
  if (!key || !String(key).trim()) return false;
  return !/REPLACE_WITH_/i.test(key);
}
