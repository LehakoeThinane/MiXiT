import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CreateEventSheet } from '@/components/create-event-sheet';
import { cancelRoomEvent, formatEventTime, getRoomEvents, setRsvp, type RoomEvent } from '@/lib/events-api';

type Props = {
  roomId: string;
  roomName: string;
};

// Upcoming live sessions and meetups for a room, with RSVP. Hosts also get
// "+ Schedule". Renders nothing when there's nothing to show.
export function RoomEventsBar({ roomId, roomName }: Props) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const eventsQuery = useQuery({
    queryKey: ['room-events', roomId],
    queryFn: () => getRoomEvents(roomId),
    enabled: Boolean(roomId),
    staleTime: 30_000,
  });

  const rsvpMutation = useMutation({
    mutationFn: ({ event, going }: { event: RoomEvent; going: boolean }) => setRsvp(event.id, going),
    onMutate: ({ event, going }) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof getRoomEvents>>>(['room-events', roomId], (prev) =>
        prev
          ? {
              ...prev,
              events: prev.events.map((e) =>
                e.id === event.id ? { ...e, going, rsvpCount: Math.max(0, e.rsvpCount + (going ? 1 : -1)) } : e
              ),
            }
          : prev
      );
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['room-events', roomId] });
      Alert.alert('Could not update RSVP', error instanceof Error ? error.message : 'Try again');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (eventId: string) => cancelRoomEvent(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room-events', roomId] });
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    },
    onError: (error) => Alert.alert('Could not cancel', error instanceof Error ? error.message : 'Try again'),
  });

  const confirmCancel = (event: RoomEvent) =>
    Alert.alert('Cancel this event?', 'Everyone who RSVP’d will be notified.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel event', style: 'destructive', onPress: () => cancelMutation.mutate(event.id) },
    ]);

  const events = eventsQuery.data?.events ?? [];
  const canHost = eventsQuery.data?.canHost ?? false;
  if (events.length === 0 && !canHost) return null;

  return (
    <View style={styles.wrap}>
      <CreateEventSheet roomId={roomId} roomName={roomName} visible={createOpen} onClose={() => setCreateOpen(false)} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {events.map((event) => (
          <View key={event.id} style={[styles.card, event.isLive && styles.cardLive]}>
            <Text style={[styles.when, event.isLive && styles.whenLive]}>
              {event.isLive ? '🔴 ' : event.kind === 'meetup' ? '📍 ' : '📅 '}
              {formatEventTime(event.startsAt, event.isLive)}
            </Text>
            <Text style={styles.title} numberOfLines={1}>
              {event.title}
            </Text>
            {event.venue ? (
              <Text style={styles.meta} numberOfLines={1}>
                {event.venue}
              </Text>
            ) : null}
            <Text style={styles.meta} numberOfLines={1}>
              Host {event.hostName} · {event.rsvpCount} going
            </Text>
            <View style={styles.actions}>
              <Pressable
                style={[styles.rsvp, event.going && styles.rsvpGoing]}
                onPress={() => rsvpMutation.mutate({ event, going: !event.going })}
                accessibilityLabel={event.going ? 'Cancel RSVP' : 'RSVP'}>
                <Text style={[styles.rsvpText, event.going && styles.rsvpTextGoing]}>
                  {event.going ? '✓ Going' : event.isLive ? 'Join' : 'I’m in'}
                </Text>
              </Pressable>
              {event.canCancel ? (
                <Pressable onPress={() => confirmCancel(event)} accessibilityLabel="Cancel event">
                  <Text style={styles.cancel}>Cancel</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}
        {canHost ? (
          <Pressable style={[styles.card, styles.addCard]} onPress={() => setCreateOpen(true)}>
            <Text style={styles.addPlus}>+</Text>
            <Text style={styles.addText}>Schedule</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  row: { paddingHorizontal: 12, gap: 10 },
  card: {
    width: 220,
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    gap: 2,
  },
  cardLive: { borderColor: 'rgba(255,107,96,0.6)', backgroundColor: 'rgba(255,59,48,0.10)' },
  when: { color: '#ffb08f', fontSize: 12, fontWeight: '700' },
  whenLive: { color: '#ff8a80' },
  title: { color: '#f4f6ff', fontSize: 15, fontWeight: '700' },
  meta: { color: '#aab0cc', fontSize: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 },
  rsvp: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: '#ff6b35' },
  rsvpGoing: { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  rsvpText: { color: '#111524', fontWeight: '700', fontSize: 13 },
  rsvpTextGoing: { color: '#e0e4f5' },
  cancel: { color: '#ff8a80', fontSize: 13, fontWeight: '600' },
  addCard: { width: 110, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' },
  addPlus: { color: '#ff6b35', fontSize: 28, fontWeight: '700' },
  addText: { color: '#ffb08f', fontWeight: '700' },
});
