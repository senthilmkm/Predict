import { create } from 'zustand';
import {
  configureSubscriptionSdk,
  purchaseDefaultPackage,
  refreshEntitlement,
  restorePurchases,
  EntitlementState,
} from '../services/subscription/revenueCat';
import { isSubscriptionModelEnabled } from '../config/pricing';

type SubState = EntitlementState & {
  busy: boolean;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  purchase: () => Promise<EntitlementState>;
  restore: () => Promise<EntitlementState>;
};

const initial: EntitlementState = {
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

export const useSubscriptionStore = create<SubState>((set, get) => ({
  ...initial,
  busy: false,
  hydrate: async () => {
    set({ busy: true });
    try {
      if (!isSubscriptionModelEnabled()) {
        set({
          ...initial,
          ready: true,
          entitled: true,
          gatingDisabled: true,
          busy: false,
          error: null,
        });
        return;
      }
      const next = await configureSubscriptionSdk();
      set({ ...next, busy: false });
    } catch (e: any) {
      set({
        ready: true,
        entitled: false,
        busy: false,
        error: String(e?.message || e),
      });
    }
  },
  refresh: async () => {
    set({ busy: true });
    const next = await refreshEntitlement();
    set({ ...next, busy: false });
  },
  purchase: async () => {
    set({ busy: true, error: null });
    const next = await purchaseDefaultPackage();
    set({ ...next, busy: false });
    return next;
  },
  restore: async () => {
    set({ busy: true, error: null });
    const next = await restorePurchases();
    set({ ...next, busy: false });
    return next;
  },
}));

/** True when the user may use trading / main UI. */
export function hasPredictAccess(s: Pick<EntitlementState, 'entitled' | 'gatingDisabled'>): boolean {
  return Boolean(s.gatingDisabled || s.entitled);
}
