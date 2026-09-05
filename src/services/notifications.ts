import { AlertKind, AppConfig } from '../config/types';
import { shouldPushAlert } from '../config/normalize';
import { Platform } from 'react-native';

export interface NotifyPayload {
  kind: AlertKind;
  title: string;
  body: string;
}

export type NotifyFn = (payload: NotifyPayload) => Promise<void>;

const ANDROID_CHANNEL_ID = 'predict-alerts';

let notifyImpl: NotifyFn = async () => {
  /* default no-op */
};

let permissionStatus: string = 'undetermined';

export function setNotifyImpl(fn: NotifyFn) {
  notifyImpl = fn;
}

function wireNotifyImpl(Notifications: any, status: string) {
  permissionStatus = status;
  setNotifyImpl(async (p) => {
    if (status !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: p.title,
        body: p.body,
        data: { kind: p.kind },
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority?.HIGH,
        ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
      trigger: null,
    });
  });
}

/** Bind handlers/channels only — do not prompt until onboarding / explicit request. */
export async function bindNativeNotifications(): Promise<void> {
  try {
    const Notifications = require('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: 'Predict alerts',
        importance: Notifications.AndroidImportance?.HIGH ?? 4,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3DB8A0',
        sound: 'default',
      });
    }

    const seenNotificationIds = new Set<string>();
    const handleIncomingNotification = (content: any, identifier?: string) => {
      if (!content) return;
      if (identifier && seenNotificationIds.has(identifier)) return;
      if (identifier) {
        seenNotificationIds.add(identifier);
        if (seenNotificationIds.size > 100) {
          const first = seenNotificationIds.values().next().value;
          if (first) seenNotificationIds.delete(first);
        }
      }
      const title = content.title || 'Alert';
      const body = content.body || '';
      const kind = content.data?.kind || content.data?.type || 'lean_signal';
      const source = content.data?.source || 'gcp';
      const { useRuntimeStore } = require('../state/runtimeStore');
      const rt = useRuntimeStore.getState().ensure();
      rt.recordAlert(kind, title, body, source);
    };

    Notifications.addNotificationReceivedListener((n: any) => {
      try {
        handleIncomingNotification(n?.request?.content, n?.request?.identifier);
      } catch {
        /* best effort */
      }
    });

    Notifications.addNotificationResponseReceivedListener((response: any) => {
      try {
        handleIncomingNotification(
          response?.notification?.request?.content,
          response?.notification?.request?.identifier
        );
      } catch {
        /* best effort */
      }
    });

    Notifications.getLastNotificationResponseAsync().then((response: any) => {
      if (!response) return;
      try {
        handleIncomingNotification(
          response?.notification?.request?.content,
          response?.notification?.request?.identifier
        );
      } catch {
        /* best effort */
      }
    });

    const settings = await Notifications.getPermissionsAsync();
    wireNotifyImpl(Notifications, settings.status);
    if (settings.status === 'granted') {
      void syncPushTokenWithCloud();
    }
  } catch {
    /* node / tests — or Expo Go without native entitlements */
  }
}

export async function syncPushTokenWithCloud(): Promise<string | null> {
  try {
    const Notifications = require('expo-notifications');
    const settings = await Notifications.getPermissionsAsync();
    if (settings.status !== 'granted') return null;

    let projectId = 'a03a8787-9892-4b03-b817-802af17715cf';
    try {
      const Constants = require('expo-constants').default;
      const easId =
        Constants?.expoConfig?.extra?.eas?.projectId ||
        Constants?.easConfig?.projectId ||
        Constants?.manifest?.extra?.eas?.projectId;
      if (easId) projectId = easId;
    } catch {}

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const pushToken = tokenData?.data;

    let deviceToken: string | null = null;
    try {
      const devTokenData = await Notifications.getDevicePushTokenAsync();
      deviceToken = devTokenData?.data;
    } catch {}

    const { cloudClient } = require('./cloud/cloudClient');
    if (pushToken) {
      await cloudClient.registerPushToken(pushToken);
    }
    if (deviceToken && typeof deviceToken === 'string') {
      const formattedDevToken = deviceToken.startsWith('ExponentPushToken')
        ? deviceToken
        : `ExponentPushToken[${deviceToken}]`;
      await cloudClient.registerPushToken(formattedDevToken);
      await cloudClient.registerPushToken(deviceToken);
    }

    return pushToken || deviceToken || null;
  } catch (err: any) {
    console.warn('[PUSH_TOKEN_SYNC_ERROR]', err?.message || err);
    return null;
  }
}

/** Prompt for notification permission (onboarding step 4 or Settings). */
export async function requestNotificationPermission(): Promise<
  'granted' | 'denied' | 'unavailable'
> {
  try {
    const Notifications = require('expo-notifications');
    const settings = await Notifications.getPermissionsAsync();
    let status = settings.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      status = req.status;
    }
    wireNotifyImpl(Notifications, status);
    if (status === 'granted') {
      void syncPushTokenWithCloud();
    }
    return status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export function getCachedNotificationPermissionStatus(): string {
  return permissionStatus;
}

export async function maybeNotify(
  cfg: AppConfig,
  kind: AlertKind,
  title: string,
  body: string
): Promise<boolean> {
  if (!shouldPushAlert(cfg, kind)) return false;
  await notifyImpl({ kind, title, body });
  return true;
}

/**
 * Always try to show a local OS notification (ignores mute matrix).
 * Used for Auto-trade background pause warnings.
 */
export async function notifySystemBanner(title: string, body: string): Promise<void> {
  try {
    await notifyImpl({ kind: 'error', title, body });
  } catch {
    /* tests / no permission */
  }
}

export async function updateAppBadgeCount(count: number): Promise<void> {
  try {
    const Notifications = require('expo-notifications');
    if (typeof Notifications.setBadgeCountAsync === 'function') {
      await Notifications.setBadgeCountAsync(Math.max(0, count));
    }
  } catch {
    /* best effort */
  }
}

