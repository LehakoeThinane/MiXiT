import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { apiRequest } from '@/lib/api-client';

/**
 * Registers this device for push notifications. With `prompt: false` (app start)
 * it only registers if permission was already granted; the system prompt is shown
 * only with `prompt: true`, from a moment where notifications clearly make sense
 * (after onboarding or the first message), not on first launch.
 */
export async function registerForPushNotifications(options: { prompt?: boolean } = {}): Promise<void> {
  if (!Device.isDevice) return;
  if (Constants.appOwnership === 'expo') return; // Expo Go dropped remote push in SDK 53

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    if (!options.prompt) return;
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'MiXiT',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#ff6b35',
    });
  }

  const projectId =
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
    '8d5afaed-69a1-4b2d-a670-3eca6208baaa';

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });

  await apiRequest('/profiles/me/push-token', {
    method: 'PUT',
    auth: true,
    body: { token: tokenData.data },
  }).catch(() => {
    // non-fatal — app works fine without push token registered
  });
}
