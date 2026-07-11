import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiquidBackdrop } from '@/components/liquid-backdrop';
import { blockUser, reportUser, type ReportReason } from '@/lib/moderation-api';
import { getPeerProfile } from '@/lib/profile-api';

const REPORT_REASONS: { reason: ReportReason; label: string }[] = [
  { reason: 'inappropriate_content', label: 'Inappropriate content' },
  { reason: 'harassment', label: 'Harassment' },
  { reason: 'fake_profile', label: 'Fake profile' },
  { reason: 'spam', label: 'Spam' },
];

export default function PeerProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string; name?: string; initial?: string; online?: string }>();
  const userId = params.id ?? '';
  const fallbackName = params.name ?? 'MiXiT user';
  const initial = (params.initial ?? fallbackName.slice(0, 1)).slice(0, 1).toUpperCase();
  const online = params.online === '1';

  const profileQuery = useQuery({
    queryKey: ['peer-profile', userId],
    queryFn: () => getPeerProfile(userId),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });

  const profile = profileQuery.data;

  const blockMutation = useMutation({
    mutationFn: () => blockUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discover-candidates'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      Alert.alert('User blocked', "You won't see each other anymore.");
      router.back();
    },
    onError: (error) => Alert.alert('Could not block user', error instanceof Error ? error.message : 'Try again'),
  });

  const reportMutation = useMutation({
    mutationFn: (reason: ReportReason) => reportUser(userId, reason),
    onSuccess: () => Alert.alert('Report submitted', 'Thanks — our team will review this.'),
    onError: (error) => Alert.alert('Could not submit report', error instanceof Error ? error.message : 'Try again'),
  });

  const handleOptions = () => {
    Alert.alert('Profile options', undefined, [
      {
        text: 'Report user',
        onPress: () =>
          Alert.alert(
            'Report this profile',
            'Why are you reporting this user?',
            REPORT_REASONS.map(({ reason, label }) => ({ text: label, onPress: () => reportMutation.mutate(reason) }))
          ),
      },
      {
        text: 'Block user',
        style: 'destructive',
        onPress: () =>
          Alert.alert("Block this user?", "You won't see each other in Discover, Chats, or Vibes anymore.", [
            { text: 'Block', style: 'destructive', onPress: () => blockMutation.mutate() },
            { text: 'Cancel', style: 'cancel' },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <LiquidBackdrop />
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Profile</Text>
        <Pressable onPress={handleOptions} style={styles.backBtn}>
          <Text style={styles.backText}>⋯</Text>
        </Pressable>
      </View>

      {profileQuery.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#ff6b35" />
        </View>
      ) : profileQuery.isError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Couldn't load profile</Text>
          <Pressable style={styles.retryBtn} onPress={() => profileQuery.refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {profile?.photos && profile.photos.length > 0 ? (
            <Image source={{ uri: profile.photos[0] }} style={styles.photo} contentFit="cover" />
          ) : (
            <View style={styles.avatarLarge}>
              <Text style={styles.avatarLargeText}>{initial}</Text>
            </View>
          )}

          <View style={styles.nameRow}>
            <Text style={styles.name}>
              {profile?.displayName ?? fallbackName}
              {profile?.age ? `, ${profile.age}` : ''}
            </Text>
            <View style={[styles.onlineDot, online ? styles.onlineDotActive : styles.onlineDotInactive]} />
          </View>

          {profile?.city ? <Text style={styles.city}>{profile.city}</Text> : null}

          {profile?.bio ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>About</Text>
              <Text style={styles.bio}>{profile.bio}</Text>
            </View>
          ) : null}

          {profile?.interests && profile.interests.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Interests</Text>
              <View style={styles.tags}>
                {profile.interests.map((tag) => (
                  <View key={tag} style={styles.tag}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {profile?.intents && profile.intents.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Looking for</Text>
              <View style={styles.tags}>
                {profile.intents.map((intent) => (
                  <View key={intent} style={[styles.tag, styles.intentTag]}>
                    <Text style={styles.tagText}>{intent}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {profile?.traits && profile.traits.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Personality</Text>
              <View style={styles.tags}>
                {profile.traits.map((trait) => (
                  <View key={trait} style={[styles.tag, styles.traitTag]}>
                    <Text style={styles.tagText}>{trait}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
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
    gap: 12,
  },
  errorText: {
    color: '#d2d8ec',
    fontSize: 16,
  },
  retryBtn: {
    backgroundColor: 'rgba(255,107,53,0.8)',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  retryText: {
    color: '#111524',
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 40,
    gap: 4,
  },
  photo: {
    width: '100%',
    height: 320,
    borderRadius: 20,
    marginBottom: 16,
  },
  avatarLarge: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#ff6b35',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarLargeText: {
    color: '#f9fbff',
    fontWeight: '700',
    fontSize: 48,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  name: {
    color: '#f6f8ff',
    fontWeight: '700',
    fontSize: 26,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 2,
  },
  onlineDotActive: {
    backgroundColor: '#65efc1',
  },
  onlineDotInactive: {
    backgroundColor: '#5a6080',
  },
  city: {
    color: '#b0b8d8',
    fontSize: 15,
    marginTop: 4,
    marginBottom: 8,
  },
  section: {
    marginTop: 20,
    gap: 8,
  },
  sectionLabel: {
    color: '#9199bc',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  bio: {
    color: '#d8deef',
    fontSize: 16,
    lineHeight: 24,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  intentTag: {
    backgroundColor: 'rgba(255,107,53,0.15)',
    borderColor: 'rgba(255,107,53,0.35)',
  },
  traitTag: {
    backgroundColor: 'rgba(101,239,193,0.1)',
    borderColor: 'rgba(101,239,193,0.3)',
  },
  tagText: {
    color: '#edf0ff',
    fontSize: 14,
    fontWeight: '600',
  },
});
