import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiquidBackdrop } from '@/components/liquid-backdrop';
import { getReceivedVibes } from '@/lib/matching-api';
import { useAuthStore } from '@/stores/auth-store';

export default function VibesScreen() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => Boolean(state.accessToken));

  const vibesQuery = useQuery({
    queryKey: ['vibes'],
    queryFn: getReceivedVibes,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const vibes = vibesQuery.data ?? [];

  return (
    <SafeAreaView style={styles.container}>
      <LiquidBackdrop />
      <Text style={styles.title}>Vibes</Text>
      <Text style={styles.subtitle}>People who vibed you</Text>

      {!isAuthenticated ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Sign in to view your vibes</Text>
          <Text style={styles.stateBody}>When people vibe you, they show up here.</Text>
        </View>
      ) : vibesQuery.isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator />
          <Text style={styles.stateBody}>Loading vibes...</Text>
        </View>
      ) : vibesQuery.isError ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Couldn’t load vibes</Text>
          <Pressable style={styles.retryBtn} onPress={() => vibesQuery.refetch()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : vibes.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>No vibes yet</Text>
          <Text style={styles.stateBody}>Keep discovering and sending vibes.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {vibes.map((profile) => (
            <View key={profile.id} style={styles.card}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{profile.initial}</Text>
              </View>
              <View style={styles.body}>
                <Text style={styles.name}>
                  {profile.name}, {profile.age}
                </Text>
                <Text style={styles.meta}>{profile.distance}</Text>
              </View>
              <Pressable
                style={styles.chatButton}
                onPress={() =>
                  router.push({
                    pathname: '/chat/[id]',
                    params: {
                      id: profile.id,
                      name: profile.name,
                      initial: profile.initial,
                      online: profile.online ? '1' : '0',
                    },
                  })
                }>
                <Text style={styles.chatButtonText}>Chat</Text>
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
    backgroundColor: '#060710',
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  title: {
    color: '#f6f7ff',
    fontSize: 34,
    fontWeight: '700',
  },
  subtitle: {
    color: '#c2c8e2',
    marginTop: 4,
    marginBottom: 8,
    fontSize: 16,
  },
  stateCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.1)',
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
    color: '#d2d7ec',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: 'rgba(255,107,53,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
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
  card: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
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
  body: {
    flex: 1,
  },
  name: {
    color: '#edf0ff',
    fontSize: 17,
    fontWeight: '700',
  },
  meta: {
    color: '#d2d8ec',
    marginTop: 2,
    fontSize: 14,
  },
  chatButton: {
    backgroundColor: 'rgba(255,107,53,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  chatButtonText: {
    color: '#111524',
    fontWeight: '700',
    fontSize: 14,
  },
});
