import * as WebBrowser from 'expo-web-browser';

import { API_BASE_URL } from '@/lib/api-client';

// Served by the backend (backend/src/modules/legal) so the same URLs can be
// entered in App Store Connect and the Play Console.
export const LEGAL_URLS = {
  privacy: `${API_BASE_URL}/legal/privacy`,
  terms: `${API_BASE_URL}/legal/terms`,
  deleteAccount: `${API_BASE_URL}/legal/delete-account`,
  childSafety: `${API_BASE_URL}/legal/child-safety`,
  support: `${API_BASE_URL}/legal/support`,
} as const;

export function openLegalPage(page: keyof typeof LEGAL_URLS) {
  return WebBrowser.openBrowserAsync(LEGAL_URLS[page]).catch(() => undefined);
}
