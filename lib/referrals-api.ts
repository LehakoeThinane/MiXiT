import { Linking, Share } from 'react-native';

import { apiRequest } from '@/lib/api-client';

export type ReferralInfo = {
  code: string;
  link: string;
  joined: number;
  rewarded: number;
  maxRewardsPerMonth: number;
};

export async function getMyReferral(): Promise<ReferralInfo> {
  const { ok: _ok, ...info } = await apiRequest<ReferralInfo & { ok: boolean }>('/referrals/me', { auth: true });
  return info;
}

function inviteMessage(info: ReferralInfo) {
  return `Join me on MiXiT — meet people nearby, join rooms and chat. Use my invite and we both get a free 30-minute Vibe Boost: ${info.link} (code ${info.code})`;
}

/** Opens WhatsApp with the invite pre-filled; falls back to the system share sheet. */
export async function shareInviteOnWhatsApp(info: ReferralInfo) {
  const url = `https://wa.me/?text=${encodeURIComponent(inviteMessage(info))}`;
  try {
    await Linking.openURL(url);
  } catch {
    await shareInvite(info);
  }
}

export async function shareInvite(info: ReferralInfo) {
  await Share.share({ message: inviteMessage(info) });
}
