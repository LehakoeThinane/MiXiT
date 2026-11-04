import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export type ActionSheetOption = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

type Props = {
  visible: boolean;
  title?: string;
  options: ActionSheetOption[];
  onClose: () => void;
};

// Cross-platform menu. Android's Alert shows at most three buttons, so menus with
// more choices (chat options) use this instead.
export function ActionSheet({ visible, title, options, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
        <View style={styles.sheet}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {options.map((option) => (
            <Pressable
              key={option.label}
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
              onPress={() => {
                onClose();
                // Let the menu close before opening the next sheet/alert.
                setTimeout(option.onPress, 250);
              }}>
              <Text style={[styles.optionText, option.destructive && styles.destructive]}>{option.label}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: '#12152a',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 28,
  },
  title: { color: '#aab0cc', fontSize: 13, fontWeight: '600', textAlign: 'center', marginBottom: 6 },
  option: { paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12 },
  optionPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  optionText: { color: '#f4f6ff', fontSize: 16, fontWeight: '600' },
  destructive: { color: '#ff8a80' },
  cancel: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  cancelText: { color: '#ccd3f5', fontWeight: '600', fontSize: 15 },
});
