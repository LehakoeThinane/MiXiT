import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { getRooms, joinRoom, leaveRoom } from '@/lib/rooms-api';
import { useAuthStore } from '@/stores/auth-store';

function formatMeta(memberCount: number, city: string) {
  const members = memberCount >= 1000 ? `${(memberCount / 1000).toFixed(1)}k` : String(memberCount);
  return `${members} active • ${city}`;
}

export default function RoomsScreen() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => Boolean(state.accessToken));

  const roomsQuery = useQuery({
    queryKey: ['rooms'],
    queryFn: getRooms,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const toggleMembershipMutation = useMutation({
    mutationFn: async ({ roomId, joined }: { roomId: string; joined: boolean }) => {
      if (joined) {
        await leaveRoom(roomId);
      } else {
        await joinRoom(roomId);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rooms'] });
    },
  });

  const rooms = roomsQuery.data ?? [];

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Rooms</Text>
      <Text style={styles.subtitle}>Find your people</Text>

      <View style={styles.searchBar}>
        <Text style={styles.searchText}>🔎 Search rooms...</Text>
      </View>

      {!isAuthenticated ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Sign in to explore rooms</Text>
        </View>
      ) : roomsQuery.isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator />
          <Text style={styles.stateBody}>Loading rooms...</Text>
        </View>
      ) : roomsQuery.isError ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Couldn’t load rooms</Text>
          <Pressable style={styles.retryBtn} onPress={() => roomsQuery.refetch()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {rooms.map((room) => (
            <View key={room.id} style={styles.roomCard}>
              <View style={styles.emojiBubble}>
                <Text style={styles.emoji}>{room.emoji}</Text>
              </View>
              <View style={styles.roomTextWrap}>
                <Text style={styles.roomTitle}>{room.name}</Text>
                <Text style={styles.roomMeta}>• {formatMeta(room.memberCount, room.city)}</Text>
              </View>
              <Pressable
                disabled={toggleMembershipMutation.isPending}
                style={[styles.roomAction, room.joined && styles.roomActionJoined]}
                onPress={() => toggleMembershipMutation.mutate({ roomId: room.id, joined: room.joined })}>
                <Text style={[styles.roomActionText, room.joined && styles.roomActionTextJoined]}>
                  {room.joined ? 'Joined' : 'Join'}
                </Text>
              </Pressable>
            </View>
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
  searchBar: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#232a44',
    backgroundColor: '#141a2c',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  searchText: {
    color: '#7f88b0',
    fontSize: 16,
    fontWeight: '600',
  },
  list: {
    gap: 10,
  },
  roomCard: {
    backgroundColor: '#13192b',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#222944',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emojiBubble: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#293063',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 20,
  },
  roomTextWrap: {
    flex: 1,
  },
  roomTitle: {
    color: '#edf0ff',
    fontSize: 17,
    fontWeight: '700',
  },
  roomMeta: {
    color: '#9099bf',
    marginTop: 2,
    fontSize: 14,
  },
  roomAction: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#29304b',
    backgroundColor: '#141a2c',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  roomActionJoined: {
    borderColor: '#ff6b35',
    backgroundColor: '#2c1b18',
  },
  roomActionText: {
    color: '#9ca5c8',
    fontWeight: '700',
    fontSize: 14,
  },
  roomActionTextJoined: {
    color: '#ff6b35',
  },
});
