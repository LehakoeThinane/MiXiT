import { create } from 'zustand';

type TypingState = {
  typingPeerIds: Record<string, boolean>;
  setTyping: (peerId: string, isTyping: boolean) => void;
};

export const useTypingStore = create<TypingState>()((set) => ({
  typingPeerIds: {},
  setTyping: (peerId, isTyping) =>
    set((state) => ({ typingPeerIds: { ...state.typingPeerIds, [peerId]: isTyping } })),
}));
