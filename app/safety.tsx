import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiquidBackdrop } from '@/components/liquid-backdrop';
import { MeetupPlanSheet } from '@/components/meetup-plan-sheet';
import { openLegalPage } from '@/lib/legal';
import { EMERGENCY_CONTACTS } from '@/lib/safety';

const SCAM_TIPS = [
  'Never send money, airtime, vouchers, e-wallet/CashSend or crypto to someone you met online — however urgent the story.',
  'Never share bank details, PINs or one-time PINs (OTPs).',
  'Be wary of anyone who quickly asks to move to another app, avoids video or voice, or has a sad emergency.',
  '“Investment” and “double your money” offers are scams.',
];

const MEETUP_TIPS = [
  'Meet in a busy public place, in daylight if you can.',
  'Tell a friend where you’re going — use “Share my meetup plan” below.',
  'Arrange your own transport there and back.',
  'Keep your drink with you and stay sober enough to decide for yourself.',
  'If something feels off, leave. You don’t owe anyone an explanation.',
];

export default function SafetyScreen() {
  const router = useRouter();
  const [planOpen, setPlanOpen] = useState(false);

  return (
    <SafeAreaView style={styles.container}>
      <LiquidBackdrop />
      <Stack.Screen options={{ headerShown: false }} />
      <MeetupPlanSheet visible={planOpen} onClose={() => setPlanOpen(false)} />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Safety centre</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, styles.toolCard]}>
          <Text style={styles.cardTitle}>Meeting someone?</Text>
          <Text style={styles.body}>
            Share who, where and when with someone you trust, and get a reminder to check in afterwards.
          </Text>
          <Pressable style={styles.primary} onPress={() => setPlanOpen(true)}>
            <Text style={styles.primaryText}>Share my meetup plan</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Spot scams</Text>
          {SCAM_TIPS.map((tip) => (
            <Text key={tip} style={styles.tip}>
              • {tip}
            </Text>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Meeting in person</Text>
          {MEETUP_TIPS.map((tip) => (
            <Text key={tip} style={styles.tip}>
              • {tip}
            </Text>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Report & block</Text>
          <Text style={styles.body}>
            Open someone’s profile or a chat and tap ⋯, or press and hold a message, to report or block. Reports are
            anonymous and reviewed by our team.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Emergency numbers</Text>
          {EMERGENCY_CONTACTS.map((contact) => (
            <Pressable
              key={contact.number}
              style={styles.callRow}
              onPress={() => Linking.openURL(`tel:${contact.number}`).catch(() => undefined)}
              accessibilityLabel={`Call ${contact.label}`}>
              <Text style={styles.callLabel}>{contact.label}</Text>
              <Text style={styles.callNumber}>{contact.number}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => openLegalPage('support')}>
          <Text style={styles.link}>Contact MiXiT support</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060710' },
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
  backBtn: { width: 36 },
  backText: { color: '#e0e4f5', fontSize: 28 },
  headerTitle: { color: '#f6f8ff', fontWeight: '700', fontSize: 18 },
  content: { padding: 18, gap: 14, paddingBottom: 40 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    padding: 16,
    gap: 6,
  },
  toolCard: { backgroundColor: 'rgba(255,107,53,0.12)', borderColor: 'rgba(255,107,53,0.35)' },
  cardTitle: { color: '#f4f6ff', fontSize: 17, fontWeight: '700', marginBottom: 2 },
  body: { color: '#c6cbe2', fontSize: 14, lineHeight: 20 },
  tip: { color: '#c6cbe2', fontSize: 14, lineHeight: 20 },
  primary: { marginTop: 8, backgroundColor: '#ff6b35', borderRadius: 12, alignItems: 'center', paddingVertical: 12 },
  primaryText: { color: '#111524', fontWeight: '700', fontSize: 15 },
  callRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  callLabel: { color: '#e3e6f5', fontSize: 14, flex: 1 },
  callNumber: { color: '#ffb08f', fontSize: 15, fontWeight: '700' },
  link: { color: '#9aa1c0', textAlign: 'center', textDecorationLine: 'underline', marginTop: 6 },
});
