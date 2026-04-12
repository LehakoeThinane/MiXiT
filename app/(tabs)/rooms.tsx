import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

const rooms = [
  { id: '1', emoji: '🎵', title: 'Amapiano Lovers', meta: '847 active • JHB', joined: false },
  { id: '2', emoji: '💼', title: 'Young Hustlers', meta: '1.2k active • JHB', joined: false },
  { id: '3', emoji: '☕', title: 'Soweto Cafe Scene', meta: '234 active • 2km', joined: false },
  { id: '4', emoji: '☀️', title: 'Sunset Singles', meta: '511 active • 4km', joined: true },
];

export default function RoomsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Rooms</Text>
      <Text style={styles.subtitle}>Find your people</Text>
      <View style={styles.infoBanner}>
        <Text style={styles.infoText}>Room list is styled preview data while we wire live rooms.</Text>
      </View>

      <View style={styles.searchBar}>
        <Text style={styles.searchText}>🔎 Search rooms...</Text>
      </View>

      <View style={styles.list}>
        {rooms.map((room) => (
          <View key={room.id} style={styles.roomCard}>
            <View style={styles.emojiBubble}>
              <Text style={styles.emoji}>{room.emoji}</Text>
            </View>
            <View style={styles.roomTextWrap}>
              <Text style={styles.roomTitle}>{room.title}</Text>
              <Text style={styles.roomMeta}>• {room.meta}</Text>
            </View>
            <Pressable style={[styles.roomAction, room.joined && styles.roomActionJoined]}>
              <Text style={[styles.roomActionText, room.joined && styles.roomActionTextJoined]}>
                {room.joined ? 'Joined' : 'Join'}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>
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
  infoBanner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#29304b',
    backgroundColor: '#141a2c',
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
  },
  infoText: {
    color: '#9ca5c8',
    fontSize: 13,
    fontWeight: '600',
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
