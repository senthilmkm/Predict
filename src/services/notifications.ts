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
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    void Notifications.setBadgeCountAsync(0);

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: 'Predict alerts',
        importance: Notifications.AndroidImportance?.HIGH ?? 4,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3DB8A0',
        sound: 'default',
      });
    }

    const settings = await Notifications.getPermissionsAsync();
    wireNotifyImpl(Notifications, settings.status);
  } catch {
    /* node / tests — or Expo Go without native entitlements */
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
