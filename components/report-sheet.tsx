import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { REPORT_REASONS, reportUser, type ReportReason } from '@/lib/moderation-api';

export type ReportTarget = {
  userId: string;
  name?: string;
  /** A direct message being reported (evidence is captured server-side). */
  messageId?: string;
  /** A room message being reported. */
  roomMessageId?: string;
};

type Props = {
  target: ReportTarget | null;
  onClose: () => void;
  /** Called after a successful report — e.g. to offer blocking. */
  onReported?: (target: ReportTarget) => void;
};

// Cross-platform report sheet. A plain Alert can't be used: Android alerts show at
// most three buttons, which silently hid most report reasons (including "underage").
export function ReportSheet({ target, onClose, onReported }: Props) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');

  useEffect(() => {
    if (target) {
      setReason(null);
      setDetails('');
    }
  }, [target]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!target || !reason) throw new Error('Choose a reason');
      return reportUser(target.userId, reason, {
        details,
        messageId: target.messageId,
        roomMessageId: target.roomMessageId,
      });
    },
    onSuccess: () => {
      const reported = target;
      onClose();
      Alert.alert('Report submitted', 'Thanks for keeping MiXiT safe. Our team reviews every report within 24 hours.');
      if (reported) onReported?.(reported);
    },
    onError: (error) => Alert.alert('Could not submit report', error instanceof Error ? error.message : 'Try again'),
  });

  const subject = target?.messageId || target?.roomMessageId ? 'this message' : target?.name ?? 'this user';

  return (
    <Modal visible={Boolean(target)} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close report" />
        <View style={styles.sheet}>
          <Text style={styles.title}>Report {subject}</Text>
          <Text style={styles.subtitle}>Your report is anonymous. Why are you reporting?</Text>

          {REPORT_REASONS.map((item) => {
            const selected = reason === item.reason;
            return (
              <Pressable
                key={item.reason}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => setReason(item.reason)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}>
                <View style={[styles.radio, selected && styles.radioSelected]} />
                <Text style={styles.optionText}>{item.label}</Text>
              </Pressable>
            );
          })}

          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder="Add details (optional)"
            placeholderTextColor="#7f87ad"
            style={styles.input}
            multiline
            maxLength={1000}
          />

          <Pressable
            style={[styles.submit, (!reason || mutation.isPending) && styles.submitDisabled]}
            disabled={!reason || mutation.isPending}
            onPress={() => mutation.mutate()}>
            {mutation.isPending ? <ActivityIndicator color="#111524" /> : <Text style={styles.submitText}>Submit report</Text>}
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
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
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
  title: {
    color: '#f4f6ff',
    fontSize: 19,
    fontWeight: '700',
  },
  subtitle: {
    color: '#aab0cc',
    fontSize: 14,
    marginBottom: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  optionSelected: {
    backgroundColor: 'rgba(255,107,53,0.16)',
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  radioSelected: {
    borderColor: '#ff6b35',
    backgroundColor: '#ff6b35',
  },
  optionText: {
    color: '#e3e6f5',
    fontSize: 15,
  },
  input: {
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    color: '#f4f6ff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
    textAlignVertical: 'top',
  },
  submit: {
    marginTop: 6,
    backgroundColor: '#ff6b35',
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 13,
  },
  submitDisabled: {
    opacity: 0.45,
  },
  submitText: {
    color: '#111524',
    fontWeight: '700',
    fontSize: 16,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelText: {
    color: '#ccd3f5',
    fontWeight: '600',
    fontSize: 15,
  },
});
