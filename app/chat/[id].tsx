import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { chatMessagesByProfileId, discoverProfiles } from '@/lib/mock-data';

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; name?: string; initial?: string; online?: string }>();
  const profileId = params.id ?? 'thandi';

  const profileFromMock = discoverProfiles.find((item) => item.id === profileId) ?? null;
  const profile = profileFromMock ?? {
    id: profileId,
    name: params.name ?? 'MiXiT user',
    age: 0,
    distance: '',
    city: '',
    tags: [],
    bio: '',
    initial: (params.initial ?? 'M').slice(0, 1).toUpperCase(),
    voiceDuration: '0:20',
    online: params.online === '1',
  };
  const messages = chatMessagesByProfileId[profileId] ?? [];

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Text style={styles.backButton} onPress={() => router.back()}>
          ←
        </Text>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{profile.initial}</Text>
        </View>
        <View style={styles.headerTextWrap}>
          <Text style={styles.name}>{profile.name}</Text>
          <Text style={styles.online}>{profile.online ? '• online' : '• offline'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.messages}>
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyBody}>Say hi and start the conversation.</Text>
          </View>
        ) : null}
        {messages.map((message) => {
          const mine = message.sender === 'me';
          return (
            <View key={message.id} style={[styles.messageWrap, mine ? styles.mineWrap : styles.theirWrap]}>
              {message.type === 'voice' ? (
                <View style={[styles.voiceBubble, mine ? styles.mineVoice : styles.theirVoice]}>
                  <Text style={styles.voicePlay}>▶</Text>
                  <View style={styles.voiceWave} />
                  <Text style={styles.voiceDuration}>{message.content}</Text>
                </View>
              ) : (
                <View style={[styles.bubble, mine ? styles.mineBubble : styles.theirBubble]}>
                  <Text style={styles.messageText}>{message.content}</Text>
                </View>
              )}
              <Text style={styles.timeText}>{message.time}</Text>
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
          editable={false}
        />
        <View style={styles.sendAction}>
          <Text style={styles.sendActionText}>➤</Text>
        </View>
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
  sendActionText: {
    color: '#131726',
    fontWeight: '700',
    fontSize: 14,
  },
});
