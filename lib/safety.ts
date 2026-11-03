import * as Notifications from 'expo-notifications';
import { Share } from 'react-native';

// ---------------------------------------------------------------------------
// Scam warning: flag chats where money comes up. Romance/"emergency" scams almost
// always end with a request for money, airtime, vouchers or crypto.
// ---------------------------------------------------------------------------

const MONEY_PATTERNS: RegExp[] = [
  /\b(send|lend|borrow|need|transfer|pay|loan)\b[^.?!]{0,40}\b(money|cash|rand|r\s?\d+|airtime|data bundle|e-?wallet|cash ?send|voucher|gift ?card|bitcoin|crypto|usdt)\b/i,
  /\b(e-?wallet|cash ?send|instant ?money|mukuru|western union|moneygram|gift ?card|bitcoin|crypto|usdt|forex)\b/i,
  /\b(bank (details|account)|account number|(your|ur) pin|otp|one[- ]time pin)\b/i,
  /\b(invest(ment)?|double your money|guaranteed returns?)\b/i,
];

export function mentionsMoney(text: string | null | undefined): boolean {
  if (!text) return false;
  return MONEY_PATTERNS.some((pattern) => pattern.test(text));
}

// ---------------------------------------------------------------------------
// Share my meetup plan with a trusted contact (WhatsApp/SMS via the share sheet).
// Nothing is stored or sent by MiXiT itself.
// ---------------------------------------------------------------------------

export async function shareMeetupPlan(input: { withName: string; where: string; when: string; notes?: string }) {
  const lines = [
    "I'm meeting someone from MiXiT — sharing my plan so someone knows where I am.",
    `Who: ${input.withName}`,
    `Where: ${input.where}`,
    `When: ${input.when}`,
    input.notes ? `Notes: ${input.notes}` : null,
    'If you can’t reach me afterwards, please check on me.',
  ].filter(Boolean);
  await Share.share({ message: lines.join('\n') });
}

// ---------------------------------------------------------------------------
// Check-in reminder: a local notification later on ("Are you OK?"). Scheduled on
// the device only; it's a nudge to check in with your trusted contact.
// ---------------------------------------------------------------------------

export async function scheduleCheckIn(minutesFromNow: number): Promise<boolean> {
  const permission = await Notifications.getPermissionsAsync();
  let granted = permission.status === 'granted';
  if (!granted) {
    granted = (await Notifications.requestPermissionsAsync()).status === 'granted';
  }
  if (!granted) return false;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'MiXiT check-in',
      body: 'How’s it going? If you’re safe, let your trusted contact know. If not, leave and call 10111.',
      data: { type: 'safety_check_in' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(60, Math.round(minutesFromNow * 60)),
      repeats: false,
    },
  });
  return true;
}

export const EMERGENCY_CONTACTS = [
  { label: 'Police (SAPS)', number: '10111' },
  { label: 'Emergency from a cellphone', number: '112' },
  { label: 'Ambulance', number: '10177' },
  { label: 'GBV Command Centre (24h)', number: '0800428428' },
  { label: 'Lifeline (24h counselling)', number: '0861322322' },
  { label: 'Childline', number: '116' },
] as const;
