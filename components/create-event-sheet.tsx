import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { createRoomEvent, type RoomEventKind } from '@/lib/events-api';

type Props = {
  roomId: string;
  roomName: string;
  visible: boolean;
  onClose: () => void;
};

const DURATIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: '3 hours', minutes: 180 },
];

function nextDays(count: number) {
  const days: Date[] = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    days.push(d);
  }
  return days;
}

function dayLabel(date: Date, index: number) {
  if (index === 0) return 'Today';
  if (index === 1) return 'Tomorrow';
  return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "20:00" / "8:30" → [hours, minutes] or null. */
function parseTime(input: string): [number, number] | null {
  const match = input.trim().match(/^(\d{1,2})[:h.](\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return [hours, minutes];
}

// Hosts schedule a live chat session or a real-world meetup in a room.
export function CreateEventSheet({ roomId, roomName, visible, onClose }: Props) {
  const queryClient = useQueryClient();
  const days = useMemo(() => nextDays(14), []);
  const [kind, setKind] = useState<RoomEventKind>('session');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [venue, setVenue] = useState('');
  const [dayIndex, setDayIndex] = useState(0);
  const [time, setTime] = useState('20:00');
  const [durationMinutes, setDurationMinutes] = useState(120);

  useEffect(() => {
    if (visible) {
      setKind('session');
      setTitle('');
      setDescription('');
      setVenue('');
      setDayIndex(0);
      setTime('20:00');
      setDurationMinutes(120);
    }
  }, [visible]);

  const parsedTime = parseTime(time);
  const startsAt = useMemo(() => {
    if (!parsedTime) return null;
    const d = new Date(days[dayIndex]);
    d.setHours(parsedTime[0], parsedTime[1], 0, 0);
    return d;
  }, [days, dayIndex, parsedTime]);
  const inPast = startsAt ? startsAt.getTime() < Date.now() - 5 * 60 * 1000 : false;
  const canSubmit =
    title.trim().length >= 3 && Boolean(startsAt) && !inPast && (kind === 'session' || venue.trim().length > 0);

  const mutation = useMutation({
    mutationFn: () => {
      if (!startsAt) throw new Error('Choose a valid time');
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
      return createRoomEvent(roomId, {
        kind,
        title: title.trim(),
        description: description.trim() || undefined,
        venue: kind === 'meetup' ? venue.trim() : undefined,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['room-events', roomId] }),
        queryClient.invalidateQueries({ queryKey: ['rooms'] }),
      ]);
      onClose();
      Alert.alert('Scheduled', 'Room members have been notified.');
    },
    onError: (error) => Alert.alert('Could not schedule', error instanceof Error ? error.message : 'Try again'),
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Schedule in {roomName}</Text>

            <View style={styles.row}>
              {(['session', 'meetup'] as RoomEventKind[]).map((option) => (
                <Pressable
                  key={option}
                  style={[styles.chip, kind === option && styles.chipActive]}
                  onPress={() => setKind(option)}>
                  <Text style={[styles.chipText, kind === option && styles.chipTextActive]}>
                    {option === 'session' ? '💬 Live session' : '📍 Meetup'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint}>
              {kind === 'session'
                ? 'Everyone chats in this room at the same time.'
                : 'A real-world hangout. Choose a busy public place.'}
            </Text>

            <TextInput value={title} onChangeText={setTitle} placeholder="Title, e.g. Amapiano Friday" placeholderTextColor="#7f87ad" style={styles.input} maxLength={80} />
            <TextInput value={description} onChangeText={setDescription} placeholder="What's it about? (optional)" placeholderTextColor="#7f87ad" style={[styles.input, styles.multiline]} maxLength={500} multiline />
            {kind === 'meetup' ? (
              <TextInput value={venue} onChangeText={setVenue} placeholder="Venue, e.g. Vilakazi St, Soweto" placeholderTextColor="#7f87ad" style={styles.input} maxLength={160} />
            ) : null}

            <Text style={styles.label}>Day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {days.map((day, index) => (
                <Pressable key={day.toISOString()} style={[styles.chip, dayIndex === index && styles.chipActive]} onPress={() => setDayIndex(index)}>
                  <Text style={[styles.chipText, dayIndex === index && styles.chipTextActive]}>{dayLabel(day, index)}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.label}>Start time (24h)</Text>
            <TextInput value={time} onChangeText={setTime} placeholder="20:00" placeholderTextColor="#7f87ad" style={[styles.input, styles.timeInput]} maxLength={5} keyboardType="numbers-and-punctuation" />
            {!parsedTime ? <Text style={styles.error}>Use a time like 20:00</Text> : inPast ? <Text style={styles.error}>That time has passed</Text> : null}

            <Text style={styles.label}>Length</Text>
            <View style={styles.row}>
              {DURATIONS.map((option) => (
                <Pressable key={option.minutes} style={[styles.chip, durationMinutes === option.minutes && styles.chipActive]} onPress={() => setDurationMinutes(option.minutes)}>
                  <Text style={[styles.chipText, durationMinutes === option.minutes && styles.chipTextActive]}>{option.label}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable style={[styles.primary, (!canSubmit || mutation.isPending) && styles.disabled]} disabled={!canSubmit || mutation.isPending} onPress={() => mutation.mutate()}>
              {mutation.isPending ? <ActivityIndicator color="#111524" /> : <Text style={styles.primaryText}>Schedule & notify members</Text>}
            </Pressable>
            <Pressable style={styles.cancel} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    maxHeight: '90%',
    backgroundColor: '#12152a',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30, gap: 8 },
  title: { color: '#f4f6ff', fontSize: 19, fontWeight: '700' },
  hint: { color: '#aab0cc', fontSize: 13 },
  label: { color: '#d5d9ea', fontSize: 14, fontWeight: '600', marginTop: 6 },
  row: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  chipActive: { backgroundColor: 'rgba(255,107,53,0.2)', borderColor: '#ff6b35' },
  chipText: { color: '#c6cbe2', fontWeight: '600' },
  chipTextActive: { color: '#ffb08f' },
  input: { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', color: '#f4f6ff', paddingHorizontal: 12, paddingVertical: 10 },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  timeInput: { width: 110 },
  error: { color: '#ff8a80', fontSize: 13 },
  primary: { marginTop: 10, backgroundColor: '#ff6b35', borderRadius: 12, alignItems: 'center', paddingVertical: 13 },
  disabled: { opacity: 0.45 },
  primaryText: { color: '#111524', fontWeight: '700', fontSize: 16 },
  cancel: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { color: '#ccd3f5', fontWeight: '600', fontSize: 15 },
});
