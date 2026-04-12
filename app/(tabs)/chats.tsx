import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { getConversations } from '@/lib/messaging-api';
import { useAuthStore } from '@/stores/auth-store';

function formatTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatsScreen() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => Boolean(state.accessToken));

  const conversationsQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: getConversations,
    enabled: isAuthenticated,
    staleTime: 20_000,
  });

  const conversations = conversationsQuery.data ?? [];

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Chats</Text>
      <Text style={styles.subtitle}>Recent conversations</Text>

      {!isAuthenticated ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Sign in to view chats</Text>
          <Text style={styles.stateBody}>Your conversations will appear here.</Text>
        </View>
      ) : conversationsQuery.isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator />
          <Text style={styles.stateBody}>Loading your chats...</Text>
        </View>
      ) : conversationsQuery.isError ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Couldn’t load chats</Text>
          <Pressable style={styles.retryBtn} onPress={() => conversationsQuery.refetch()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : conversations.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>No chats yet</Text>
          <Text style={styles.stateBody}>Start with a Vibe in Discover to open your first chat.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {conversations.map((conversation) => (
            <Pressable
              key={conversation.id}
              style={styles.row}
              onPress={() =>
                router.push({
                  pathname: '/chat/[id]',
                  params: {
                    id: conversation.id,
                    name: conversation.name,
                    initial: conversation.initial,
                    online: conversation.online ? '1' : '0',
                  },
                })
              }>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{conversation.initial}</Text>
              </View>
              <View style={styles.rowText}>
                <Text style={styles.name}>{conversation.name}</Text>
                <Text style={styles.preview}>{conversation.preview}</Text>
              </View>
              <Text style={styles.time}>{formatTimeLabel(conversation.lastMessageAt)}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0d18',
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  title: {
    color: '#f6f7ff',
    fontSize: 34,
    fontWeight: '700',
  },
  subtitle: {
    color: '#98a1c7',
    marginTop: 4,
    marginBottom: 8,
    fontSize: 16,
  },
  stateCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#29304b',
    backgroundColor: '#141a2c',
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
    alignItems: 'center',
    gap: 8,
  },
  stateTitle: {
    color: '#edf0ff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateBody: {
    color: '#9ca5c8',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: '#ff6b35',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryBtnText: {
    color: '#111524',
    fontWeight: '700',
    fontSize: 14,
  },
  list: {
    gap: 10,
  },
  row: {
    backgroundColor: '#13192b',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#222944',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ff6b35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#f9fbff',
    fontWeight: '700',
    fontSize: 17,
  },
  rowText: {
    flex: 1,
  },
  name: {
    color: '#edf0ff',
    fontSize: 17,
    fontWeight: '700',
  },
  preview: {
    color: '#9099bf',
    marginTop: 2,
    fontSize: 14,
  },
  time: {
    color: '#8f97bc',
    fontSize: 12,
    fontWeight: '600',
  },
});
