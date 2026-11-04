import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { scheduleCheckIn, shareMeetupPlan } from '@/lib/safety';

type Props = {
  visible: boolean;
  /** Pre-filled "who" (e.g. the person you're chatting with). */
  withName?: string;
  onClose: () => void;
};

const CHECK_IN_OPTIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: '3 hours', minutes: 180 },
];

// "Share my meetup plan" + "Remind me to check in" — both stay on the phone:
// the plan goes to a contact the user picks in WhatsApp/SMS, the reminder is a
// local notification.
export function MeetupPlanSheet({ visible, withName, onClose }: Props) {
  const [who, setWho] = useState(withName ?? '');
  const [where, setWhere] = useState('');
  const [when, setWhen] = useState('');
  const [checkInMinutes, setCheckInMinutes] = useState<number | null>(120);

  useEffect(() => {
    if (visible) {
      setWho(withName ?? '');
      setWhere('');
      setWhen('');
      setCheckInMinutes(120);
    }
  }, [visible, withName]);

  const canShare = who.trim().length > 0 && where.trim().length > 0 && when.trim().length > 0;

  const handleShare = async () => {
    try {
      await shareMeetupPlan({ withName: who.trim(), where: where.trim(), when: when.trim() });
      if (checkInMinutes) {
        const scheduled = await scheduleCheckIn(checkInMinutes);
        if (!scheduled) {
          Alert.alert('Check-in not set', 'Allow notifications for MiXiT to get a check-in reminder.');
        }
      }
      onClose();
    } catch (error) {
      Alert.alert('Could not share', error instanceof Error ? error.message : 'Try again');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <Text style={styles.title}>Share my meetup plan</Text>
          <Text style={styles.subtitle}>
            Send your plan to someone you trust (WhatsApp, SMS…). MiXiT doesn’t store or share it.
          </Text>

          <TextInput value={who} onChangeText={setWho} placeholder="Who are you meeting?" placeholderTextColor="#7f87ad" style={styles.input} maxLength={60} />
          <TextInput value={where} onChangeText={setWhere} placeholder="Where? (a public place)" placeholderTextColor="#7f87ad" style={styles.input} maxLength={120} />
          <TextInput value={when} onChangeText={setWhen} placeholder="When? e.g. Sat 14:00" placeholderTextColor="#7f87ad" style={styles.input} maxLength={60} />

          <Text style={styles.label}>Remind me to check in after</Text>
          <View style={styles.chips}>
            {CHECK_IN_OPTIONS.map((option) => {
              const active = checkInMinutes === option.minutes;
              return (
                <Pressable key={option.minutes} style={[styles.chip, active && styles.chipActive]} onPress={() => setCheckInMinutes(active ? null : option.minutes)}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable style={[styles.primary, !canShare && styles.disabled]} disabled={!canShare} onPress={handleShare}>
            <Text style={styles.primaryText}>Share plan</Text>
          </Pressable>
          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: '#12152a',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 30,
    gap: 8,
  },
  title: { color: '#f4f6ff', fontSize: 19, fontWeight: '700' },
  subtitle: { color: '#aab0cc', fontSize: 13, lineHeight: 18, marginBottom: 4 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    color: '#f4f6ff',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: { color: '#d5d9ea', fontSize: 14, fontWeight: '600', marginTop: 6 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  chipActive: { backgroundColor: 'rgba(255,107,53,0.2)', borderColor: '#ff6b35' },
  chipText: { color: '#c6cbe2', fontWeight: '600' },
  chipTextActive: { color: '#ffb08f' },
  primary: { marginTop: 8, backgroundColor: '#ff6b35', borderRadius: 12, alignItems: 'center', paddingVertical: 13 },
  disabled: { opacity: 0.45 },
  primaryText: { color: '#111524', fontWeight: '700', fontSize: 16 },
  cancel: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { color: '#ccd3f5', fontWeight: '600', fontSize: 15 },
});
