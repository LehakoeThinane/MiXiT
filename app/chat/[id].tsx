import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { getThreadMessages, sendMessage, type ThreadMessage } from '@/lib/messaging-api';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket-client';
import { useAuthStore } from '@/stores/auth-store';

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
  const [draft, setDraft] = useState('');

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
    if (!accessToken || !peerUserId) return;

    const socket = connectSocket(accessToken);
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

    socket.on('message:received', onReceived);
    socket.on('message:sent', onReceived);

    return () => {
      socket.off('message:received', onReceived);
      socket.off('message:sent', onReceived);
      const activeSocket = getSocket();
      if (activeSocket && activeSocket.listeners('message:received').length === 0) {
        disconnectSocket();
      }
    };
  }, [accessToken, peerUserId, queryClient, user?.id]);

  const canSend = useMemo(() => draft.trim().length > 0 && !sendMutation.isPending, [draft, sendMutation.isPending]);

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Text style={styles.backButton} onPress={() => router.back()}>
          ←
        </Text>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{peerInitial}</Text>
        </View>
        <View style={styles.headerTextWrap}>
          <Text style={styles.name}>{peerName}</Text>
          <Text style={styles.online}>{peerOnline ? '• online' : '• offline'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.messages}>
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
              <Text style={styles.timeText}>{formatTime(message.createdAt)}</Text>
            </View>
          );
        })}
      </ScrollView>

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
          onChangeText={setDraft}
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0d18',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#181d2f',
  },
  backButton: {
    color: '#c6cde8',
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
    marginRight: 10,
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
    color: '#33d69f',
    fontWeight: '600',
    fontSize: 13,
  },
  messages: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 90,
    gap: 10,
  },
  emptyState: {
    backgroundColor: '#141a2c',
    borderWidth: 1,
    borderColor: '#252d49',
    borderRadius: 14,
    padding: 14,
  },
  emptyTitle: {
    color: '#eef1ff',
    fontWeight: '700',
    fontSize: 16,
  },
  emptyBody: {
    color: '#9ea6c9',
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
    borderBottomRightRadius: 6,
  },
  theirBubble: {
    backgroundColor: '#171c2f',
    borderBottomLeftRadius: 6,
  },
  messageText: {
    color: '#f4f6ff',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  timeText: {
    color: '#7d85a8',
    fontSize: 12,
    marginTop: 4,
  },
  voiceBubble: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#242c47',
    paddingHorizontal: 10,
    height: 40,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  mineVoice: {
    backgroundColor: '#2b2432',
  },
  theirVoice: {
    backgroundColor: '#151a2a',
  },
  voicePlay: {
    color: '#ff6b35',
    fontWeight: '700',
  },
  voiceWave: {
    width: 64,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#525b85',
  },
  voiceDuration: {
    color: '#9ea6c9',
    fontWeight: '700',
    fontSize: 12,
  },
  inputBar: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#12172a',
    borderWidth: 1,
    borderColor: '#262d47',
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
    backgroundColor: '#1b2238',
  },
  smallActionText: {
    fontSize: 13,
  },
  input: {
    flex: 1,
    color: '#d6dbf4',
    fontSize: 15,
    paddingVertical: 0,
  },
  sendAction: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff6b35',
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
