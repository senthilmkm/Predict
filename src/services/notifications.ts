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

export function setNotifyImpl(fn: NotifyFn) {
  notifyImpl = fn;
}

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

    // iOS / Android: without permission, alerts are silent or suppressed
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
  } catch {
    /* node / tests — or Expo Go without native entitlements */
  }
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
