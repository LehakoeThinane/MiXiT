import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiquidBackdrop } from '@/components/liquid-backdrop';
import { getBlockedUsers, unblockUser, type BlockedUser } from '@/lib/moderation-api';

export default function BlockedUsersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const blockedQuery = useQuery({ queryKey: ['blocked-users'], queryFn: getBlockedUsers });

  const unblockMutation = useMutation({
    mutationFn: (userId: string) => unblockUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocked-users'] });
      queryClient.invalidateQueries({ queryKey: ['discover-candidates'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (error) => Alert.alert('Could not unblock', error instanceof Error ? error.message : 'Try again'),
  });

  const confirmUnblock = (item: BlockedUser) =>
    Alert.alert(`Unblock ${item.name}?`, 'You may see each other in Discover, Chats and Rooms again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unblock', onPress: () => unblockMutation.mutate(item.userId) },
    ]);

  return (
    <SafeAreaView style={styles.container}>
      <LiquidBackdrop />
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Blocked users</Text>
        <View style={styles.backBtn} />
      </View>

      {blockedQuery.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#ff6b35" />
        </View>
      ) : blockedQuery.isError ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Couldn&apos;t load blocked users</Text>
          <Pressable onPress={() => blockedQuery.refetch()}>
            <Text style={styles.link}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={blockedQuery.data ?? []}
          keyExtractor={(item) => item.userId}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>You haven&apos;t blocked anyone.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Pressable
                style={styles.unblockBtn}
                disabled={unblockMutation.isPending}
                onPress={() => confirmUnblock(item)}>
                <Text style={styles.unblockText}>Unblock</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060710',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.14)',
  },
  backBtn: {
    width: 36,
  },
  backText: {
    color: '#e0e4f5',
    fontSize: 28,
  },
  headerTitle: {
    color: '#f6f8ff',
    fontWeight: '700',
    fontSize: 18,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  list: {
    padding: 18,
    gap: 10,
  },
  emptyText: {
    color: '#c6cbe2',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 24,
  },
  link: {
    color: '#ffb08f',
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,107,53,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
  },
  name: {
    flex: 1,
    color: '#f4f6ff',
    fontSize: 16,
    fontWeight: '600',
  },
  unblockBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  unblockText: {
    color: '#e0e4f5',
    fontWeight: '700',
  },
});
