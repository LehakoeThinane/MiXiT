import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiquidBackdrop } from '@/components/liquid-backdrop';
import { getThreadMessages, sendMessage, type ThreadMessage } from '@/lib/messaging-api';
import { getSocket } from '@/lib/socket-client';
import { useAuthStore } from '@/stores/auth-store';
import { useUnreadStore } from '@/stores/unread-store';

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string; name?: string; initial?: string; online?: string }>();
  const peerUserId = params.id ?? '';
  const { user, accessToken } = useAuthStore();
  const markChatOpened = useUnreadStore((state) => state.markChatOpened);
  const [draft, setDraft] = useState('');
  const [peerTyping, setPeerTyping] = useState(false);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingDot = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);

  const threadQuery = useQuery({
    queryKey: ['thread', peerUserId],
    queryFn: () => getThreadMessages(peerUserId),
    enabled: Boolean(accessToken && peerUserId),
    staleTime: 5_000,
  });

  const messages = threadQuery.data ?? [];
  const peerName = params.name ?? 'MiXiT user';
  const peerInitial = (params.initial ?? 'M').slice(0, 1).toUpperCase();
  const peerOnline = params.online === '1';

  const sendMutation = useMutation({
    mutationFn: async (content: string) =>
      sendMessage({
        recipientId: peerUserId,
        content,
        type: 'text',
      }),
    onSuccess: async (message) => {
      setDraft('');
      queryClient.setQueryData<ThreadMessage[]>(['thread', peerUserId], (current) => {
        const existing = current ?? [];
        if (existing.some((item) => item.id === message.id)) return existing;
        return [...existing, message];
      });
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  useEffect(() => {
    if (!peerUserId) return;
    const socket = getSocket();
    if (!socket) return;

    const onReceived = (message: ThreadMessage) => {
      if (
        !(
          (message.senderId === peerUserId && message.recipientId === user?.id) ||
          (message.senderId === user?.id && message.recipientId === peerUserId)
        )
      ) {
        return;
      }
      queryClient.setQueryData<ThreadMessage[]>(['thread', peerUserId], (current) => {
        const existing = current ?? [];
        if (existing.some((item) => item.id === message.id)) return existing;
        return [...existing, message];
      });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };

    const onRead = ({ messageIds }: { byUserId: string; messageIds: string[] }) => {
      const idSet = new Set(messageIds);
      queryClient.setQueryData<ThreadMessage[]>(['thread', peerUserId], (current) =>
        current?.map((m) => (idSet.has(m.id) ? { ...m, readAt: new Date().toISOString() } : m)) ?? []
      );
    };

    socket.on('message:received', onReceived);
    socket.on('message:sent', onReceived);
    socket.on('message:read', onRead);

    return () => {
      socket.off('message:received', onReceived);
      socket.off('message:sent', onReceived);
      socket.off('message:read', onRead);
    };
  }, [peerUserId, queryClient, user?.id]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !peerUserId) return;

    const onTypingStart = ({ senderId }: { senderId: string }) => {
      if (senderId !== peerUserId) return;
      setPeerTyping(true);
      Animated.loop(
        Animated.sequence([
          Animated.timing(typingDot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(typingDot, { toValue: 0, duration: 400, useNativeDriver: true }),
        ])
      ).start();
    };
    const onTypingStop = ({ senderId }: { senderId: string }) => {
      if (senderId !== peerUserId) return;
      setPeerTyping(false);
      typingDot.stopAnimation();
      typingDot.setValue(0);
    };

    socket.on('typing:start', onTypingStart);
    socket.on('typing:stop', onTypingStop);
    return () => {
      socket.off('typing:start', onTypingStart);
      socket.off('typing:stop', onTypingStop);
    };
  }, [peerUserId, typingDot]);

  const handleDraftChange = (text: string) => {
    setDraft(text);
    const socket = getSocket();
    if (!socket || !peerUserId) return;
    socket.emit('typing:start', { recipientId: peerUserId });
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socket.emit('typing:stop', { recipientId: peerUserId });
    }, 1500);
  };

  const canSend = useMemo(() => draft.trim().length > 0 && !sendMutation.isPending, [draft, sendMutation.isPending]);

  useEffect(() => {
    if (peerUserId) markChatOpened(peerUserId);
  }, [peerUserId, markChatOpened]);

  useEffect(() => {
    if (messages.length > 0) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [messages.length]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
      <SafeAreaView style={styles.container}>
      <LiquidBackdrop />
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Text style={styles.backButton} onPress={() => router.back()}>
          ←
        </Text>
        <Pressable
          style={styles.headerProfile}
          onPress={() =>
            router.push({
              pathname: '/profile/[id]',
              params: { id: peerUserId, name: peerName, initial: peerInitial, online: params.online ?? '0' },
            })
          }>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{peerInitial}</Text>
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={styles.name}>{peerName}</Text>
            <Text style={styles.online}>{peerOnline ? '• online' : '• offline'}</Text>
          </View>
        </Pressable>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.messages}>
        {threadQuery.isLoading ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Loading messages...</Text>
          </View>
        ) : null}
        {!threadQuery.isLoading && messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyBody}>Say hi and start the conversation.</Text>
          </View>
        ) : null}
        {messages.map((message) => {
          const mine = message.senderId === user?.id;
          return (
            <View key={message.id} style={[styles.messageWrap, mine ? styles.mineWrap : styles.theirWrap]}>
              {message.type === 'voice' ? (
                <View style={[styles.voiceBubble, mine ? styles.mineVoice : styles.theirVoice]}>
                  <Text style={styles.voicePlay}>▶</Text>
                  <View style={styles.voiceWave} />
                  <Text style={styles.voiceDuration}>0:20</Text>
                </View>
              ) : (
                <View style={[styles.bubble, mine ? styles.mineBubble : styles.theirBubble]}>
                  <Text style={styles.messageText}>{message.content ?? ''}</Text>
                </View>
              )}
              <View style={styles.timeRow}>
                <Text style={styles.timeText}>{formatTime(message.createdAt)}</Text>
                {mine ? (
                  <Text style={[styles.tick, message.readAt ? styles.tickRead : styles.tickSent]}>
                    {message.readAt ? '✓✓' : '✓'}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {peerTyping ? (
        <View style={styles.typingRow}>
          <View style={styles.typingBubble}>
            {[0, 150, 300].map((delay) => (
              <Animated.View
                key={delay}
                style={[
                  styles.typingDot,
                  {
                    opacity: typingDot,
                    transform: [{ translateY: Animated.multiply(typingDot, new Animated.Value(-3)) }],
                  },
                ]}
              />
            ))}
          </View>
          <Text style={styles.typingLabel}>{peerName} is typing</Text>
        </View>
      ) : null}

      <View style={styles.inputBar}>
        <View style={styles.smallAction}>
          <Text style={styles.smallActionText}>🎙</Text>
        </View>
        <View style={styles.smallAction}>
          <Text style={styles.smallActionText}>📷</Text>
        </View>
        <TextInput
          placeholder="Message..."
          placeholderTextColor="#7f87ad"
          style={styles.input}
          value={draft}
          onChangeText={handleDraftChange}
          editable={!sendMutation.isPending}
        />
        <Pressable
          style={[styles.sendAction, !canSend && styles.sendActionDisabled]}
          disabled={!canSend}
          onPress={() => sendMutation.mutate(draft.trim())}>
          <Text style={styles.sendActionText}>➤</Text>
        </Pressable>
      </View>
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#060710',
  },
  container: {
    flex: 1,
    backgroundColor: '#060710',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.14)',
  },
  headerProfile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backButton: {
    color: '#e0e4f5',
    fontSize: 28,
    marginRight: 8,
    width: 24,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ff6b35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#f6f8ff',
    fontWeight: '700',
    fontSize: 16,
  },
  headerTextWrap: {
    gap: 2,
  },
  name: {
    color: '#f6f8ff',
    fontWeight: '700',
    fontSize: 18,
  },
  online: {
    color: '#65efc1',
    fontWeight: '600',
    fontSize: 13,
  },
  messages: {
    flexGrow: 1,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 10,
  },
  emptyState: {
    backgroundColor: 'rgba(255,255,255,0.11)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 14,
    padding: 14,
  },
  emptyTitle: {
    color: '#eef1ff',
    fontWeight: '700',
    fontSize: 16,
  },
  emptyBody: {
    color: '#d2d7eb',
    fontSize: 14,
    marginTop: 4,
  },
  messageWrap: {
    maxWidth: '84%',
  },
  mineWrap: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  theirWrap: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 16,
  },
  mineBubble: {
    backgroundColor: '#ff6b35',
    borderBottomRightRadius: 4,
  },
  theirBubble: {
    backgroundColor: '#1e2340',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  messageText: {
    color: '#f4f6ff',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  timeText: {
    color: '#c7cce2',
    fontSize: 12,
  },
  tick: {
    fontSize: 12,
    fontWeight: '700',
  },
  tickSent: {
    color: '#6b7299',
  },
  tickRead: {
    color: '#ff6b35',
  },
  voiceBubble: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    height: 40,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  mineVoice: {
    backgroundColor: 'rgba(255,107,53,0.22)',
  },
  theirVoice: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  voicePlay: {
    color: '#ff6b35',
    fontWeight: '700',
  },
  voiceWave: {
    width: 64,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(150,159,197,0.9)',
  },
  voiceDuration: {
    color: '#d0d5ea',
    fontWeight: '700',
    fontSize: 12,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 4,
    gap: 8,
  },
  typingBubble: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: '#1e2340',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#9199bc',
  },
  typingLabel: {
    color: '#9199bc',
    fontSize: 13,
    fontStyle: 'italic',
  },
  inputBar: {
    marginHorizontal: 12,
    marginBottom: 12,
    marginTop: 6,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 8,
  },
  smallAction: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  smallActionText: {
    fontSize: 13,
  },
  input: {
    flex: 1,
    color: '#eef0fc',
    fontSize: 15,
    paddingVertical: 0,
  },
  sendAction: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,107,53,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  sendActionDisabled: {
    opacity: 0.5,
  },
  sendActionText: {
    color: '#131726',
    fontWeight: '700',
    fontSize: 14,
  },
});
