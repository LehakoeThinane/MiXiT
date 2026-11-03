import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Audio } from 'expo-av';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionSheet, type ActionSheetOption } from '@/components/action-sheet';
import { LiquidBackdrop } from '@/components/liquid-backdrop';
import { MeetupPlanSheet } from '@/components/meetup-plan-sheet';
import { ReportSheet, type ReportTarget } from '@/components/report-sheet';
import { blockUser } from '@/lib/moderation-api';
import { registerForPushNotifications } from '@/lib/notifications';
import { mentionsMoney } from '@/lib/safety';
import { compressImage } from '@/lib/media';
import { getThreadMessages, requestMediaUploadUrl, sendMessage, type ThreadMessage, uploadMediaToStorage } from '@/lib/messaging-api';
import { getSocket } from '@/lib/socket-client';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';
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
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSecs, setRecordingSecs] = useState(0);
  const [isSendingVoice, setIsSendingVoice] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingDot = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [scamWarningDismissed, setScamWarningDismissed] = useState(false);
  // Data saver: chat photos only download when tapped.
  const dataSaver = useSettingsStore((state) => state.dataSaver);
  const [loadedImageIds, setLoadedImageIds] = useState<Set<string>>(() => new Set());
  const askedForPushRef = useRef(false);

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
      // Ask for notification permission in context — right after the first message sent.
      if (!askedForPushRef.current) {
        askedForPushRef.current = true;
        void registerForPushNotifications({ prompt: true });
      }
    },
    onError: (error) => Alert.alert('Message not sent', error instanceof Error ? error.message : 'Try again'),
  });

  const blockMutation = useMutation({
    mutationFn: () => blockUser(peerUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
      Alert.alert('User blocked', "You won't see each other anymore.");
      router.back();
    },
    onError: (error) => Alert.alert('Could not block user', error instanceof Error ? error.message : 'Try again'),
  });

  const confirmBlock = () =>
    Alert.alert(`Block ${peerName}?`, "You won't see each other in Discover, Chats, Rooms or Vibes anymore.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => blockMutation.mutate() },
    ]);

  const openPeerProfile = () =>
    router.push({
      pathname: '/profile/[id]',
      params: { id: peerUserId, name: peerName, initial: peerInitial, online: params.online ?? '0' },
    });

  const chatMenuOptions: ActionSheetOption[] = [
    { label: 'View profile', onPress: openPeerProfile },
    { label: 'Share my meetup plan', onPress: () => setPlanOpen(true) },
    { label: 'Safety tips', onPress: () => router.push('/safety') },
    { label: 'Report user', onPress: () => setReportTarget({ userId: peerUserId, name: peerName }) },
    { label: 'Block user', destructive: true, onPress: confirmBlock },
  ];
  const handleOptions = () => setMenuOpen(true);

  const handleMessageLongPress = (message: ThreadMessage) =>
    Alert.alert('Message', undefined, [
      {
        text: 'Report message',
        onPress: () => setReportTarget({ userId: peerUserId, name: peerName, messageId: message.id }),
      },
      { text: 'Block user', style: 'destructive', onPress: confirmBlock },
      { text: 'Cancel', style: 'cancel' },
    ]);

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

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingSecs(0);
      recordingTimer.current = setInterval(() => setRecordingSecs((s) => s + 1), 1000);
    } catch {
      // permission denied or device error — silently ignore
    }
  };

  const cancelRecording = async () => {
    if (recordingTimer.current) clearInterval(recordingTimer.current);
    try {
      await recordingRef.current?.stopAndUnloadAsync();
    } catch {}
    recordingRef.current = null;
    setIsRecording(false);
    setRecordingSecs(0);
  };

  const stopAndSendRecording = async () => {
    if (!recordingRef.current) return;
    if (recordingTimer.current) clearInterval(recordingTimer.current);
    setIsRecording(false);
    setIsSendingVoice(true);
    const duration = recordingSecs;
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      if (!uri) throw new Error('No recording URI');

      const filename = `voice-${Date.now()}.m4a`;
      const { signedUrl, publicUrl } = await requestMediaUploadUrl(filename, 'audio/m4a');
      await uploadMediaToStorage(signedUrl, uri, 'audio/m4a');

      await sendMessage({
        recipientId: peerUserId,
        type: 'voice',
        content: String(duration),
        mediaUrl: publicUrl,
      });
      await queryClient.invalidateQueries({ queryKey: ['thread', peerUserId] });
    } catch {
      // upload or send failed — silently reset
    } finally {
      setIsSendingVoice(false);
      setRecordingSecs(0);
    }
  };

  const togglePlayVoice = async (message: ThreadMessage) => {
    if (playingId === message.id) {
      await soundRef.current?.pauseAsync();
      setPlayingId(null);
      return;
    }
    if (soundRef.current) {
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    if (!message.mediaUrl) return;
    setPlayingId(message.id);
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: message.mediaUrl },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setPlayingId(null);
            sound.unloadAsync();
          }
        }
      );
      soundRef.current = sound;
    } catch {
      setPlayingId(null);
    }
  };

  const sendImageMessage = async () => {
    // No media-library permission needed: the system photo picker grants one-off
    // access (Google Play photo/video permission policy).
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    try {
      // Resize + compress before upload (saves data for both people in the chat).
      const { uri, mimeType } = await compressImage(asset.uri, asset.width);
      const filename = `image-${Date.now()}.jpg`;
      const { signedUrl, publicUrl } = await requestMediaUploadUrl(filename, mimeType);
      await uploadMediaToStorage(signedUrl, uri, mimeType);
      await sendMessage({ recipientId: peerUserId, type: 'image', mediaUrl: publicUrl });
      await queryClient.invalidateQueries({ queryKey: ['thread', peerUserId] });
    } catch (err) {
      Alert.alert('Image failed', err instanceof Error ? err.message : 'Could not send image.');
    }
  };

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
      recordingRef.current?.stopAndUnloadAsync();
      if (recordingTimer.current) clearInterval(recordingTimer.current);
    };
  }, []);

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

  // Scam warning when the other person brings up money, vouchers, crypto, OTPs…
  const showScamWarning =
    !scamWarningDismissed &&
    messages.some((m) => m.senderId === peerUserId && m.type === 'text' && mentionsMoney(m.content));

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
      <SafeAreaView style={styles.container}>
      <LiquidBackdrop />
      <Stack.Screen options={{ headerShown: false }} />
      <ReportSheet target={reportTarget} onClose={() => setReportTarget(null)} />
      <ActionSheet visible={menuOpen} title={peerName} options={chatMenuOptions} onClose={() => setMenuOpen(false)} />
      <MeetupPlanSheet visible={planOpen} withName={peerName} onClose={() => setPlanOpen(false)} />

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
        <Pressable onPress={handleOptions} style={styles.optionsButton} accessibilityLabel="Chat options">
          <Text style={styles.optionsText}>⋯</Text>
        </Pressable>
      </View>

      {showScamWarning ? (
        <View style={styles.scamBanner}>
          <Text style={styles.scamTitle}>⚠️ Money talk? Be careful.</Text>
          <Text style={styles.scamBody}>
            Never send money, airtime, vouchers or crypto, or share bank details or OTPs with someone you met online.
          </Text>
          <View style={styles.scamActions}>
            <Pressable onPress={() => router.push('/safety')}>
              <Text style={styles.scamLink}>Safety tips</Text>
            </Pressable>
            <Pressable onPress={() => setReportTarget({ userId: peerUserId, name: peerName })}>
              <Text style={styles.scamLink}>Report</Text>
            </Pressable>
            <Pressable onPress={() => setScamWarningDismissed(true)}>
              <Text style={styles.scamDismiss}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

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
            <Pressable
              key={message.id}
              style={[styles.messageWrap, mine ? styles.mineWrap : styles.theirWrap]}
              onLongPress={mine ? undefined : () => handleMessageLongPress(message)}
              delayLongPress={350}>
              {message.type === 'voice' ? (
                <Pressable
                  style={[styles.voiceBubble, mine ? styles.mineVoice : styles.theirVoice]}
                  onLongPress={mine ? undefined : () => handleMessageLongPress(message)}
                  onPress={() => togglePlayVoice(message)}>
                  <Text style={styles.voicePlay}>{playingId === message.id ? '⏸' : '▶'}</Text>
                  <View style={styles.voiceWave} />
                  <Text style={styles.voiceDuration}>
                    {message.content && !Number.isNaN(Number(message.content))
                      ? `0:${String(Number(message.content)).padStart(2, '0')}`
                      : '0:00'}
                  </Text>
                </Pressable>
              ) : message.type === 'image' && message.mediaUrl ? (
                dataSaver && !mine && !loadedImageIds.has(message.id) ? (
                  <Pressable
                    style={[styles.imageBubble, styles.imagePlaceholder]}
                    onPress={() => setLoadedImageIds((prev) => new Set(prev).add(message.id))}
                    accessibilityLabel="Load photo">
                    <Text style={styles.imagePlaceholderIcon}>🖼️</Text>
                    <Text style={styles.imagePlaceholderText}>Tap to load photo</Text>
                  </Pressable>
                ) : (
                  <Image
                    source={{ uri: message.mediaUrl }}
                    style={styles.imageBubble}
                    contentFit="cover"
                    cachePolicy="disk"
                  />
                )
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
            </Pressable>
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

      {isRecording || isSendingVoice ? (
        <View style={styles.inputBar}>
          <Pressable style={styles.smallAction} onPress={cancelRecording} disabled={isSendingVoice}>
            <Text style={styles.smallActionText}>✕</Text>
          </Pressable>
          <View style={styles.recordingIndicator}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingTimer}>
              {isSendingVoice ? 'Sending...' : `0:${String(recordingSecs).padStart(2, '0')}`}
            </Text>
          </View>
          <Pressable
            style={[styles.sendAction, isSendingVoice && styles.sendActionDisabled]}
            disabled={isSendingVoice}
            onPress={stopAndSendRecording}>
            <Text style={styles.sendActionText}>➤</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.inputBar}>
          <Pressable style={styles.smallAction} onPress={startRecording}>
            <Text style={styles.smallActionText}>🎙</Text>
          </Pressable>
          <Pressable style={styles.smallAction} onPress={sendImageMessage}>
            <Text style={styles.smallActionText}>📷</Text>
          </Pressable>
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
      )}
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
  optionsButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  optionsText: {
    color: '#e0e4f5',
    fontSize: 26,
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
  imagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    gap: 4,
  },
  imagePlaceholderIcon: {
    fontSize: 28,
  },
  imagePlaceholderText: {
    color: '#c6cbe2',
    fontSize: 13,
    fontWeight: '600',
  },
  scamBanner: {
    marginHorizontal: 12,
    marginTop: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,193,7,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,193,7,0.45)',
    gap: 4,
  },
  scamTitle: {
    color: '#ffe08a',
    fontWeight: '700',
    fontSize: 14,
  },
  scamBody: {
    color: '#e9e3c8',
    fontSize: 13,
    lineHeight: 18,
  },
  scamActions: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 4,
  },
  scamLink: {
    color: '#ffe08a',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  scamDismiss: {
    color: '#c9c3a8',
    fontWeight: '600',
  },
  imageBubble: {
    width: 220,
    height: 220,
    borderRadius: 14,
    overflow: 'hidden',
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
  recordingIndicator: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ff3b30',
  },
  recordingTimer: {
    color: '#eef0fc',
    fontSize: 15,
    fontWeight: '600',
  },
  sendActionText: {
    color: '#131726',
    fontWeight: '700',
    fontSize: 14,
  },
});
