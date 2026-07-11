import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type UnreadState = {
  lastVibesSeenCount: number;
  lastChatOpenedAt: Record<string, number>;
  markVibesSeen: (count: number) => void;
  markChatOpened: (conversationId: string) => void;
};

export const useUnreadStore = create<UnreadState>()(
  persist(
    (set) => ({
      lastVibesSeenCount: -1,
      lastChatOpenedAt: {},
      markVibesSeen: (count) => set({ lastVibesSeenCount: count }),
      markChatOpened: (conversationId) =>
        set((state) => ({
          lastChatOpenedAt: { ...state.lastChatOpenedAt, [conversationId]: Date.now() },
        })),
    }),
    {
      name: 'mixit-unread',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
