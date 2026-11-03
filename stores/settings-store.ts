import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type SettingsState = {
  /** Data saver: chat photos load on tap, no background animation. */
  dataSaver: boolean;
  setDataSaver: (value: boolean) => void;
  /** Invite code from a link (mixit://invite/CODE), applied when signing up. */
  pendingReferralCode: string | null;
  setPendingReferralCode: (code: string | null) => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      dataSaver: false,
      setDataSaver: (value) => set({ dataSaver: value }),
      pendingReferralCode: null,
      setPendingReferralCode: (code) => set({ pendingReferralCode: code }),
    }),
    { name: 'MiXiT-settings', storage: createJSONStorage(() => AsyncStorage) }
  )
);
