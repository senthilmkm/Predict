import { Platform } from 'react-native';
import {
  getPricingConfig,
  hasUsableRevenueCatKey,
  isSubscriptionModelEnabled,
} from '../../config/pricing';

export type EntitlementState = {
  ready: boolean;
  entitled: boolean;
  isTrialing: boolean;
  productId: string | null;
  expirationAt: string | null;
  willRenew: boolean;
  managementUrl: string | null;
  error: string | null;
  /** True when pricing.json disabled subscription gating (owner kill-switch). */
  gatingDisabled: boolean;
  /** True when SDK keys are missing — purchases cannot run until configured. */
  sdkConfigured: boolean;
};

const EMPTY: EntitlementState = {
  ready: false,
  entitled: false,
  isTrialing: false,
  productId: null,
  expirationAt: null,
  willRenew: false,
  managementUrl: null,
  error: null,
  gatingDisabled: false,
  sdkConfigured: false,
};

let purchases: any = null;
let configured = false;

function platformKey(): string {
  const cfg = getPricingConfig();
  return Platform.OS === 'ios' ? cfg.revenueCat.iosApiKey : cfg.revenueCat.androidApiKey;
}

async function loadPurchasesModule(): Promise<any | null> {
  if (purchases) return purchases;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    purchases = require('react-native-purchases').default;
    return purchases;
  } catch {
    return null;
  }
}

export async function configureSubscriptionSdk(): Promise<EntitlementState> {
  if (!isSubscriptionModelEnabled()) {
    return {
      ...EMPTY,
      ready: true,
      entitled: true,
      gatingDisabled: true,
      sdkConfigured: false,
    };
  }

  const sdkConfigured = hasUsableRevenueCatKey(Platform.OS === 'ios' ? 'ios' : 'android');
  if (!sdkConfigured) {
    // Tests / local Expo without a real RevenueCat key: unlock UI only.
    // Production builds MUST ship a real key — entitlement is Apple ID–bound via StoreKit.
    const unlockForDevOrTest =
      typeof process !== 'undefined' &&
      (process.env.NODE_ENV === 'test' ||
        process.env.EXPO_PUBLIC_UNLOCK_WITHOUT_RC === '1' ||
        (typeof __DEV__ !== 'undefined' && __DEV__));
    return {
      ...EMPTY,
      ready: true,
      entitled: unlockForDevOrTest,
      sdkConfigured: false,
      error: unlockForDevOrTest
        ? null
        : 'Subscription SDK key not configured. Add your RevenueCat key in pricing.json before shipping.',
    };
  }

  const Purchases = await loadPurchasesModule();
  if (!Purchases) {
    return {
      ...EMPTY,
      ready: true,
      entitled: false,
      sdkConfigured: false,
      error: 'Purchases native module unavailable in this build.',
    };
  }

  try {
    if (!configured) {
      Purchases.configure({ apiKey: platformKey() });
      configured = true;
    }
    return await refreshEntitlement();
  } catch (e: any) {
    return {
      ...EMPTY,
      ready: true,
      entitled: false,
      sdkConfigured: true,
      error: String(e?.message || e),
    };
  }
}

function mapCustomerInfo(info: any): EntitlementState {
  const cfg = getPricingConfig();
  const entId = cfg.subscription.entitlementId;
  const active = info?.entitlements?.active?.[entId];
  const entitled = Boolean(active);
  const periodType = String(active?.periodType || '').toUpperCase();
  const isTrialing = periodType === 'TRIAL' || periodType === 'INTRO';
  return {
    ready: true,
    entitled,
    isTrialing,
    productId: active?.productIdentifier ?? null,
    expirationAt: active?.expirationDate ?? null,
    willRenew: Boolean(active?.willRenew),
    managementUrl: info?.managementURL ?? cfg.urls.manageSubscriptionsIOS,
    error: null,
    gatingDisabled: false,
    sdkConfigured: true,
  };
}

export async function refreshEntitlement(): Promise<EntitlementState> {
  if (!isSubscriptionModelEnabled()) {
    return {
      ...EMPTY,
      ready: true,
      entitled: true,
      gatingDisabled: true,
    };
  }
  const Purchases = await loadPurchasesModule();
  if (!Purchases || !configured) {
    return configureSubscriptionSdk();
  }
  try {
    const info = await Purchases.getCustomerInfo();
    return mapCustomerInfo(info);
  } catch (e: any) {
    return {
      ...EMPTY,
      ready: true,
      entitled: false,
      sdkConfigured: true,
      error: String(e?.message || e),
    };
  }
}

export async function purchaseDefaultPackage(): Promise<EntitlementState> {
  const Purchases = await loadPurchasesModule();
  if (!Purchases || !configured) {
    return configureSubscriptionSdk();
  }
  const cfg = getPricingConfig();
  try {
    const offerings = await Purchases.getOfferings();
    const offering =
      offerings?.all?.[cfg.subscription.offeringId] || offerings?.current || null;
    const pkg =
      offering?.availablePackages?.find(
        (p: any) =>
          p?.product?.identifier === cfg.subscription.productId ||
          p?.identifier === '$rc_monthly' ||
          p?.packageType === 'MONTHLY'
      ) || offering?.availablePackages?.[0];

    if (!pkg) {
      return {
        ...(await refreshEntitlement()),
        error: 'No subscription package found. Check App Store Connect + RevenueCat offering.',
      };
    }
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return mapCustomerInfo(customerInfo);
  } catch (e: any) {
    const cancelled = e?.userCancelled || e?.code === '1' || /cancel/i.test(String(e?.message));
    if (cancelled) {
      return { ...(await refreshEntitlement()), error: null };
    }
    return {
      ...(await refreshEntitlement()),
      error: String(e?.message || e),
    };
  }
}

export async function restorePurchases(): Promise<EntitlementState> {
  const Purchases = await loadPurchasesModule();
  if (!Purchases || !configured) {
    return configureSubscriptionSdk();
  }
  try {
    const info = await Purchases.restorePurchases();
    const mapped = mapCustomerInfo(info);
    if (!mapped.entitled) {
      return {
        ...mapped,
        error: 'No active subscription found for this Apple ID.',
      };
    }
    return mapped;
  } catch (e: any) {
    return {
      ...(await refreshEntitlement()),
      error: String(e?.message || e),
    };
  }
}
