import { FlashList } from '@shopify/flash-list';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiquidBackdrop } from '@/components/liquid-backdrop';
import { type DiscoverCandidate, getDiscoverCandidates, sendVibe } from '@/lib/matching-api';
import { useAuthStore } from '@/stores/auth-store';

function Waveform({ active }: { active: boolean }) {
  return (
    <View style={styles.waveformRow}>
      {Array.from({ length: 18 }).map((_, i) => {
        const baseHeight = 6 + ((i * 7) % 16);
        const height = active ? baseHeight + (i % 2 === 0 ? 6 : 0) : baseHeight;
        return <View key={i} style={[styles.waveBar, { height }]} />;
      })}
    </View>
  );
}

function ProfileCard({
  profile,
  isPlaying,
  onTogglePlay,
  onVibe,
  onChat,
}: {
  profile: DiscoverCandidate;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onVibe: () => void;
  onChat: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.hero}>
        <View style={styles.heroDots}>
          <View style={styles.heroDotActive} />
          <View style={styles.heroDot} />
          <View style={styles.heroDot} />
        </View>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{profile.initial}</Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <Text style={styles.nameText}>
          {profile.name}, {profile.age}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>• {profile.distance}</Text>
          <Text style={styles.metaText}>{profile.city}</Text>
        </View>

        <View style={styles.tagWrap}>
          {profile.tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.voiceBar} onPress={onTogglePlay}>
          <View style={styles.playCircle}>
            <Text style={styles.playIcon}>{isPlaying ? '||' : '▶'}</Text>
          </View>
          <Waveform active={isPlaying} />
          <Text style={styles.voiceDuration}>{profile.voiceDuration}</Text>
        </Pressable>

        <Text style={styles.bioText}>{`"${profile.bio}"`}</Text>
      </View>

      <View style={styles.cardActions}>
        <Pressable style={[styles.actionBtn, styles.vibeBtn]} onPress={onVibe}>
          <Text style={styles.vibeBtnText}>👋 Vibe</Text>
        </Pressable>
        <Pressable style={[styles.actionBtn, styles.chatBtn]} onPress={onChat}>
          <Text style={styles.chatBtnText}>💬 Chat</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function DiscoverScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [matchProfile, setMatchProfile] = useState<DiscoverCandidate | null>(null);
  const isAuthenticated = useAuthStore((state) => Boolean(state.accessToken));

  const candidatesQuery = useQuery({
    queryKey: ['discover-candidates'],
    queryFn: getDiscoverCandidates,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const profiles = candidatesQuery.data ?? [];
  const vibeMutation = useMutation({
    mutationFn: async (profile: DiscoverCandidate) => sendVibe(profile.id),
    onSuccess: async (result, profile) => {
      await queryClient.invalidateQueries({ queryKey: ['discover-candidates'] });
      await queryClient.invalidateQueries({ queryKey: ['vibes'] });
      if (result.matched) {
        setMatchProfile(profile);
        return;
      }
      Alert.alert('Vibe sent', `You vibed ${profile.name}.`);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Could not send vibe';
      Alert.alert('Vibe failed', message);
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      <LiquidBackdrop />
      <View style={styles.headerRow}>
        <Text style={styles.screenTitle}>Discover</Text>
        <View style={styles.headerActions}>
          <View style={styles.headerIcon} />
          <View style={styles.headerIcon} />
        </View>
      </View>

      {!isAuthenticated ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Sign in to discover</Text>
          <Text style={styles.stateBody}>Complete your profile to see people nearby.</Text>
        </View>
      ) : candidatesQuery.isLoading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator />
          <Text style={styles.stateBody}>Finding people near you...</Text>
        </View>
      ) : candidatesQuery.isError ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Couldn’t load Discover</Text>
          <Text style={styles.stateBody}>Check connection and try again.</Text>
          <Pressable style={styles.retryBtn} onPress={() => candidatesQuery.refetch()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : profiles.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>No one nearby yet</Text>
          <Text style={styles.stateBody}>Invite friends to MiXiT or check back soon.</Text>
        </View>
      ) : (
        <FlashList
          data={profiles}
          keyExtractor={(item) => item.id}
          estimatedItemSize={440}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <ProfileCard
              profile={item}
              isPlaying={playingId === item.id}
              onTogglePlay={() => setPlayingId((prev) => (prev === item.id ? null : item.id))}
              onVibe={() => {
                if (vibeMutation.isPending) return;
                vibeMutation.mutate(item);
              }}
              onChat={() =>
                router.push({
                  pathname: '/chat/[id]',
                  params: {
                    id: item.id,
                    name: item.name,
                    initial: item.initial,
                    online: item.online ? '1' : '0',
                  },
                })
              }
            />
          )}
        />
      )}

      <Modal visible={Boolean(matchProfile)} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.matchCard}>
            <Text style={styles.matchTopText}>IT'S A MATCH</Text>

            <View style={styles.matchAvatars}>
              <View style={styles.matchAvatarPrimary}>
                <Text style={styles.matchAvatarText}>Y</Text>
              </View>
              <View style={styles.matchAvatarSecondary}>
                <Text style={styles.matchAvatarText}>{matchProfile?.initial ?? 'T'}</Text>
              </View>
            </View>

            <Text style={styles.matchTitle}>You and {matchProfile?.name} vibed!</Text>
            <Text style={styles.matchBody}>
              You both showed interest. Say something warm, don't leave them waiting.
            </Text>

            <Pressable
              style={[styles.matchButton, styles.matchPrimary]}
              onPress={() => {
                const id = matchProfile?.id;
                setMatchProfile(null);
                if (id && matchProfile) {
                  router.push({
                    pathname: '/chat/[id]',
                    params: {
                      id,
                      name: matchProfile.name,
                      initial: matchProfile.initial,
                      online: matchProfile.online ? '1' : '0',
                    },
                  });
                }
              }}>
              <Text style={styles.matchPrimaryText}>Send a message</Text>
            </Pressable>

            <Pressable style={[styles.matchButton, styles.matchSecondary]} onPress={() => setMatchProfile(null)}>
              <Text style={styles.matchSecondaryText}>Keep discovering</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060710',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  screenTitle: {
    color: '#f6f7ff',
    fontSize: 34,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
    gap: 14,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
  },
  hero: {
    height: 310,
    backgroundColor: 'rgba(65,78,147,0.54)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroDots: {
    position: 'absolute',
    top: 12,
    flexDirection: 'row',
    gap: 6,
  },
  heroDotActive: {
    width: 28,
    height: 4,
    borderRadius: 4,
    backgroundColor: '#f5f7ff',
  },
  heroDot: {
    width: 18,
    height: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  avatarCircle: {
    width: 126,
    height: 126,
    borderRadius: 63,
    backgroundColor: '#ff6b35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 52,
    color: '#f9fbff',
    fontWeight: '700',
  },
  cardBody: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  nameText: {
    color: '#f4f6ff',
    fontSize: 36,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
    marginBottom: 8,
  },
  metaText: {
    color: '#d4d9eb',
    fontSize: 16,
    fontWeight: '600',
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  tagText: {
    color: '#d9ddf0',
    fontSize: 16,
    fontWeight: '600',
  },
  voiceBar: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    height: 54,
    paddingHorizontal: 10,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  playCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ff6b35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    color: '#fafbff',
    fontWeight: '700',
    fontSize: 12,
  },
  waveformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flex: 1,
  },
  waveBar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: '#ff6b35',
  },
  voiceDuration: {
    color: '#c6cbe2',
    fontSize: 16,
    fontWeight: '700',
  },
  bioText: {
    color: '#e2e5f4',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
    marginBottom: 12,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  vibeBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  chatBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  vibeBtnText: {
    color: '#ffb08f',
    fontWeight: '700',
    fontSize: 16,
  },
  chatBtnText: {
    color: '#ccd3f5',
    fontWeight: '700',
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(7, 9, 16, 0.66)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  matchCard: {
    width: '100%',
    borderRadius: 24,
    padding: 22,
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    alignItems: 'center',
  },
  matchTopText: {
    color: '#ff6b35',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 1,
    marginBottom: 10,
  },
  matchAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  matchAvatarPrimary: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ff6b35',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -8,
    zIndex: 2,
  },
  matchAvatarSecondary: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#2f3d80',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#0f1221',
  },
  matchAvatarText: {
    color: '#f8f9ff',
    fontWeight: '700',
    fontSize: 30,
  },
  matchTitle: {
    color: '#f4f6ff',
    fontWeight: '700',
    fontSize: 30,
    textAlign: 'center',
    marginBottom: 8,
  },
  matchBody: {
    color: '#9fa6c7',
    textAlign: 'center',
    fontSize: 17,
    lineHeight: 24,
    marginBottom: 16,
  },
  matchButton: {
    width: '100%',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    marginTop: 8,
  },
  matchPrimary: {
    backgroundColor: '#ff6b35',
  },
  matchSecondary: {
    backgroundColor: 'rgba(255,255,255,0.11)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  matchPrimaryText: {
    color: '#111524',
    fontWeight: '700',
    fontSize: 17,
  },
  matchSecondaryText: {
    color: '#c4cae6',
    fontWeight: '700',
    fontSize: 17,
  },
  stateCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    padding: 20,
    alignItems: 'center',
    gap: 10,
  },
  stateTitle: {
    color: '#f4f6ff',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateBody: {
    color: '#d5d9ea',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 4,
    backgroundColor: 'rgba(255,107,53,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryBtnText: {
    color: '#121625',
    fontWeight: '700',
    fontSize: 15,
  },
});
