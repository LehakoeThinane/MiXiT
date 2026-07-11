import { logger } from '../utils/logger.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function sendPushNotification(
  token: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (!token?.startsWith('ExponentPushToken[')) return;

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: token, title, body, data, sound: 'default' }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn('Push notification failed', { status: response.status, body: text });
    }
  } catch (error) {
    logger.warn('Push notification error', { error: error instanceof Error ? error.message : String(error) });
  }
}
