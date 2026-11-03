import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiquidBackdrop } from '@/components/liquid-backdrop';
import { ReportSheet, type ReportTarget } from '@/components/report-sheet';
import { RoomEventsBar } from '@/components/room-events-bar';
import { blockUser, getBlockedUsers } from '@/lib/moderation-api';
import { getRoomMessages, sendRoomMessage, type RoomMessage } from '@/lib/rooms-api';
import { getSocket } from '@/lib/socket-client';
import { useAuthStore } from '@/stores/auth-store';

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getInitial(name: string) {
  return (name ?? 'M').slice(0, 1).toUpperCase();
}

export default function RoomChatScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string; name?: string; emoji?: string }>();
  const roomId = params.id ?? '';
  const roomName = params.name ?? 'Room';
  const roomEmoji = params.emoji ?? '💬';
  const { user, accessToken } = useAuthStore();
  const myUserId = user?.id ?? '';

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const messagesQuery = useQuery({
    queryKey: ['room-messages', roomId],
    queryFn: () => getRoomMessages(roomId),
    enabled: Boolean(accessToken && roomId),
    staleTime: 5_000,
  });

  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  // Live messages arrive over the socket broadcast, so hide blocked users here too
  // (the history endpoint already filters them server-side).
  const blockedQuery = useQuery({
    queryKey: ['blocked-users'],
    queryFn: getBlockedUsers,
    enabled: Boolean(accessToken),
    staleTime: 60_000,
  });
  const blockedIds = new Set((blockedQuery.data ?? []).map((item) => item.userId));
  const messages = (messagesQuery.data ?? []).filter((msg) => !blockedIds.has(msg.userId));

  const blockMutation = useMutation({
    mutationFn: (userId: string) => blockUser(userId),
    onSuccess: (_data, userId) => {
      queryClient.setQueryData<RoomMessage[]>(['room-messages', roomId], (prev) =>
        (prev ?? []).filter((m) => m.userId !== userId)
      );
      queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      Alert.alert('User blocked', "You won't see their messages anymore.");
    },
    onError: (error) => Alert.alert('Could not block user', error instanceof Error ? error.message : 'Try again'),
  });

  // Alert is limited to 3 buttons on Android — keep this menu at 3.
  const handleMessageLongPress = (msg: RoomMessage) =>
    Alert.alert(msg.senderName, undefined, [
      {
        text: 'Report message',
        onPress: () => setReportTarget({ userId: msg.userId, name: msg.senderName, roomMessageId: msg.id }),
      },
      {
        text: 'Block user',
        style: 'destructive',
        onPress: () =>
          Alert.alert(`Block ${msg.senderName}?`, "You won't see each other in Discover, Chats or Rooms anymore.", [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Block', style: 'destructive', onPress: () => blockMutation.mutate(msg.userId) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  // Join the socket room channel and listen for new messages
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !roomId) return;

    socket.emit('room:join', { roomId });

    const handleMessage = (msg: RoomMessage) => {
      if (msg.roomId !== roomId) return;
      queryClient.setQueryData<RoomMessage[]>(['room-messages', roomId], (prev) => {
        if (!prev) return [msg];
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };

    socket.on('room:message', handleMessage);
    return () => {
      socket.off('room:message', handleMessage);
    };
  }, [roomId, queryClient]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setSending(true);

    // Optimistic message
    const tempId = `temp-${Date.now()}`;
    const optimistic: RoomMessage = {
      id: tempId,
      roomId,
      userId: myUserId,
      senderName: 'You',
      content: text,
      createdAt: new Date().toISOString(),
    };
    queryClient.setQueryData<RoomMessage[]>(['room-messages', roomId], (prev) => [
      ...(prev ?? []),
      optimistic,
    ]);

    try {
      const saved = await sendRoomMessage(roomId, text);
      queryClient.setQueryData<RoomMessage[]>(['room-messages', roomId], (prev) =>
        (prev ?? []).map((m) => (m.id === tempId ? saved : m))
      );
    } catch (error) {
      // rollback optimistic
      queryClient.setQueryData<RoomMessage[]>(['room-messages', roomId], (prev) =>
        (prev ?? []).filter((m) => m.id !== tempId)
      );
      setDraft(text);
      // e.g. blocked by the content filter, or account under review
      Alert.alert('Message not sent', error instanceof Error ? error.message : 'Try again');
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <LiquidBackdrop dimmerOpacity={0.72} />
      <ReportSheet target={reportTarget} onClose={() => setReportTarget(null)} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <View style={styles.headerEmoji}>
          <Text style={styles.headerEmojiText}>{roomEmoji}</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>{roomName}</Text>
          <Text style={styles.headerSub}>Group chat</Text>
        </View>
      </View>

      <RoomEventsBar roomId={roomId} roomName={roomName} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.messageList}
          keyboardShouldPersistTaps="handled">
          {messagesQuery.isLoading ? (
            <Text style={styles.loadingText}>Loading messages...</Text>
          ) : messages.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>{roomEmoji}</Text>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptySub}>Be the first to say something!</Text>
            </View>
          ) : (
            messages.map((msg) => {
              const isMe = msg.userId === myUserId;
              return (
                <Pressable
                  key={msg.id}
                  style={[styles.messageRow, isMe && styles.messageRowRight]}
                  onLongPress={isMe ? undefined : () => handleMessageLongPress(msg)}
                  delayLongPress={350}>
                  {!isMe && (
                    <View style={styles.avatarBubble}>
                      <Text style={styles.avatarText}>{getInitial(msg.senderName)}</Text>
                    </View>
                  )}
                  <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                    {!isMe && (
                      <Text style={styles.senderName}>{msg.senderName}</Text>
                    )}
                    <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{msg.content}</Text>
                    <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
                      {formatTime(msg.createdAt)}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${roomName}...`}
            placeholderTextColor="#8d90a6"
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={handleSend}
            multiline
          />
          <Pressable
            style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
            disabled={!draft.trim() || sending}
            onPress={handleSend}>
            <Text style={styles.sendBtnText}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060710',
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  backBtn: {
    padding: 6,
  },
  backArrow: {
    color: '#ff6b35',
    fontSize: 22,
    fontWeight: '700',
  },
  headerEmoji: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(79,95,179,0.68)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerEmojiText: {
    fontSize: 20,
  },
  headerInfo: {
    flex: 1,
  },
  headerName: {
    color: '#f6f7ff',
    fontSize: 17,
    fontWeight: '700',
  },
  headerSub: {
    color: '#8d90a6',
    fontSize: 13,
    marginTop: 1,
  },
  messageList: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
    flexGrow: 1,
  },
  loadingText: {
    color: '#8d90a6',
    textAlign: 'center',
    marginTop: 40,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    gap: 8,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyTitle: {
    color: '#edf0ff',
    fontSize: 20,
    fontWeight: '700',
  },
  emptySub: {
    color: '#8d90a6',
    fontSize: 15,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    maxWidth: '82%',
  },
  messageRowRight: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  avatarBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(45,53,97,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    color: '#c3c9e0',
    fontSize: 13,
    fontWeight: '700',
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    maxWidth: '100%',
  },
  bubbleMe: {
    backgroundColor: '#ff6b35',
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    backgroundColor: 'rgba(45,53,97,0.85)',
    borderBottomLeftRadius: 4,
  },
  senderName: {
    color: '#a0aacc',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 3,
  },
  bubbleText: {
    color: '#edf0ff',
    fontSize: 15,
    lineHeight: 20,
  },
  bubbleTextMe: {
    color: '#fff',
  },
  bubbleTime: {
    color: 'rgba(163,174,212,0.7)',
    fontSize: 11,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  bubbleTimeMe: {
    color: 'rgba(255,255,255,0.65)',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(6,7,16,0.92)',
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    color: '#f6f7ff',
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#ff6b35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: 'rgba(255,107,53,0.3)',
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
});
