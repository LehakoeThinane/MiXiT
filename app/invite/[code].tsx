import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { useSettingsStore } from '@/stores/settings-store';

// Opened by invite links (mixit://invite/CODE): remember the code, then go to the
// Profile tab where sign-up happens. The code is sent with the first sign-in.
export default function InviteScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const setPendingReferralCode = useSettingsStore((state) => state.setPendingReferralCode);
  const normalized = typeof code === 'string' && /^[A-Za-z0-9]{8}$/.test(code) ? code.toUpperCase() : null;

  useEffect(() => {
    if (normalized) setPendingReferralCode(normalized);
  }, [normalized, setPendingReferralCode]);

  return <Redirect href="/" />;
}
