import Slider from '@react-native-community/slider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError, API_BASE_URL } from '@/lib/api-client';
import { getCurrentUser, requestOtp, verifyOtp } from '@/lib/auth-api';
import { getMyProfile, upsertMyProfile } from '@/lib/profile-api';
import { useAuthStore } from '@/stores/auth-store';

type Gender = 'male' | 'female' | 'homesexual';
type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const NAME_SUGGESTIONS = ['Lerato', 'Thandi', 'Lehakoe', 'Anele', 'Kagiso'];
const VIBE_OPTIONS = [
  'Music',
  'Sport',
  'Coffee',
  'Faith',
  'Hustle',
  'Travel',
  'Food',
  'Gaming',
  'Art',
  'Nature',
];

const clampStep = (value: number) => Math.max(1, Math.min(7, value)) as Step;

function parseInterestsFromBio(bio?: string | null) {
  if (!bio) return [];
  return bio
    .replace(/^Into\s+/i, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function parseInterests(profile: { interests?: string[] | null; bio?: string | null }) {
  if (Array.isArray(profile.interests)) {
    return profile.interests
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  return parseInterestsFromBio(profile.bio);
}

function resolveErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

function Progress({ step }: { step: Step }) {
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressSegments}>
        {Array.from({ length: 7 }).map((_, i) => {
          const active = i + 1 <= step;
          return <View key={i} style={[styles.segment, active && styles.segmentActive]} />;
        })}
      </View>
      <View style={styles.bottomDots}>
        {Array.from({ length: 7 }).map((_, i) => {
          const active = i + 1 === step;
          return <View key={i} style={[styles.dot, active && styles.dotActive]} />;
        })}
      </View>
    </View>
  );
}

function OtpBoxes({ code, verified }: { code: string; verified: boolean }) {
  return (
    <View style={styles.otpRow}>
      {Array.from({ length: 6 }).map((_, i) => {
        const char = code[i] ?? '';
        return (
          <View key={i} style={[styles.otpBox, verified && styles.otpBoxVerified]}>
            <Text style={styles.otpChar}>{char}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function ProfileTabScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const slide = useRef(new Animated.Value(0)).current;
  const voiceTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceMsRef = useRef(0);
  const sessionBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didShowSessionBannerRef = useRef(false);

  const { hasHydrated, user, accessToken, refreshToken, setSession, clearSession } = useAuthStore();
  const isAuthenticated = Boolean(accessToken && user);
  const hasSessionTokens = Boolean(accessToken && refreshToken);

  const [step, setStep] = useState<Step>(1);
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpVerified, setOtpVerified] = useState(false);
  const [lastDebugCode, setLastDebugCode] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [age, setAge] = useState(24);
  const [gender, setGender] = useState<Gender>('female');
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);

  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [waveform, setWaveform] = useState<number[]>(Array.from({ length: 24 }, () => 8));
  const hasVoiceClip = recordSeconds > 0 && !isRecording;
  const [stepError, setStepError] = useState<string | null>(null);
  const [showSessionRestoredBanner, setShowSessionRestoredBanner] = useState(false);
  const [showCompletionStep, setShowCompletionStep] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  const sessionQuery = useQuery({
    queryKey: ['session-me'],
    queryFn: getCurrentUser,
    enabled: hasHydrated && hasSessionTokens,
    retry: false,
    staleTime: 60_000,
  });

  const isRestoringSession = hasHydrated && hasSessionTokens && sessionQuery.isLoading;

  const profileQuery = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: getMyProfile,
    enabled: isAuthenticated,
  });

  useEffect(() => {
    Animated.sequence([
      Animated.timing(slide, {
        toValue: 14,
        duration: 0,
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(slide, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [slide, step]);

  useEffect(() => {
    if (sessionQuery.isError) {
      clearSession();
      setStep(1);
      setStepError('Your session expired. Please sign in again.');
      return;
    }

    if (sessionQuery.data?.user && accessToken && refreshToken) {
      setSession({
        user: {
          id: sessionQuery.data.user.id,
          phone: sessionQuery.data.user.phone,
        },
        accessToken,
        refreshToken,
      });
    }
  }, [accessToken, clearSession, refreshToken, sessionQuery.data, sessionQuery.isError, setSession]);

  useEffect(() => {
    if (!sessionQuery.data?.user || !hasSessionTokens || didShowSessionBannerRef.current) return;

    didShowSessionBannerRef.current = true;
    setShowSessionRestoredBanner(true);
    if (sessionBannerTimerRef.current) clearTimeout(sessionBannerTimerRef.current);
    sessionBannerTimerRef.current = setTimeout(() => setShowSessionRestoredBanner(false), 2800);
  }, [hasSessionTokens, sessionQuery.data?.user]);

  useEffect(() => {
    if (isAuthenticated && step < 3) {
      setStep(3);
    }
  }, [isAuthenticated, step]);

  useEffect(() => {
    if (!profileQuery.data) return;

    const profile = profileQuery.data;
    setDisplayName(profile.displayName ?? '');
    setAge(profile.age ?? 24);
    setGender((profile.gender as Gender) ?? 'female');
    setSelectedVibes(parseInterests(profile));
  }, [profileQuery.data]);

  const requestOtpMutation = useMutation({
    mutationFn: async (inputPhone: string) => requestOtp(inputPhone),
    onSuccess: (payload) => {
      setStepError(null);
      setStep(2);
      setOtpCode('');
      setOtpVerified(false);
      setLastDebugCode(payload.debugCode ?? null);
      if (payload.debugCode) {
        Alert.alert('Dev OTP', `Use code ${payload.debugCode}`);
      }
    },
    onError: (error) => {
      const message = resolveErrorMessage(error);
      setStepError(message);
      Alert.alert('Request OTP failed', message);
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async ({ inputPhone, code }: { inputPhone: string; code: string }) =>
      verifyOtp(inputPhone, code),
    onSuccess: async (payload) => {
      setStepError(null);
      setSession({
        user: payload.user,
        accessToken: payload.tokens.accessToken,
        refreshToken: payload.tokens.refreshToken,
      });
      setOtpVerified(true);
      setTimeout(() => setStep(3), 280);
      await queryClient.invalidateQueries({ queryKey: ['profile', payload.user.id] });
    },
    onError: (error) => {
      setOtpVerified(false);
      const message = resolveErrorMessage(error);
      setStepError(message);
      Alert.alert('Verify OTP failed', message);
    },
  });

  useEffect(() => {
    if (step !== 2 || otpCode.length !== 6 || verifyOtpMutation.isPending) return;
    verifyOtpMutation.mutate({ inputPhone: phone, code: otpCode });
  }, [otpCode, phone, step, verifyOtpMutation]);

  const saveProfileMutation = useMutation({
    mutationFn: async () =>
      upsertMyProfile({
        displayName: displayName.trim(),
        age,
        gender,
        bio: selectedVibes.length ? `Into ${selectedVibes.join(', ')}` : 'MiXiT user',
        interests: selectedVibes,
      }),
    onSuccess: async () => {
      setStepError(null);
      await queryClient.invalidateQueries({ queryKey: ['profile', user?.id] });
      setIsEditingProfile(false);
      setShowCompletionStep(true);
      setStep(7);
    },
    onError: (error) => {
      const message = resolveErrorMessage(error);
      setStepError(message);
      Alert.alert('Save failed', message);
    },
  });

  const canProceedStep3 = displayName.trim().length >= 2;
  const canProceedStep5 = selectedVibes.length >= 3;
  const canSaveProfile = displayName.trim().length >= 2 && selectedVibes.length >= 3;
  const hasExistingProfile = Boolean(profileQuery.data);
  const shouldShowProfileHome = isAuthenticated && hasExistingProfile && !showCompletionStep;

  const toggleVibe = (vibe: string) => {
    setSelectedVibes((prev) => {
      if (prev.includes(vibe)) return prev.filter((v) => v !== vibe);
      if (prev.length >= 8) return prev;
      return [...prev, vibe];
    });
  };

  const runResendAutofill = async () => {
    if (requestOtpMutation.isPending) return;
    try {
      const payload = await requestOtpMutation.mutateAsync(phone);
      const target = payload.debugCode ?? lastDebugCode ?? String(Math.floor(100000 + Math.random() * 900000));
      setOtpCode('');
      setOtpVerified(false);
      setStepError(null);

      for (let i = 1; i <= 6; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        setOtpCode(target.slice(0, i));
      }
    } catch {
      // handled by mutation onError
    }
  };

  const handleLogout = () => {
    clearSession();
    setStep(1);
    setPhone('');
    setOtpCode('');
    setOtpVerified(false);
    setStepError(null);
    setShowCompletionStep(false);
    setIsEditingProfile(false);
  };

  const stopRecording = () => {
    if (voiceTickerRef.current) {
      clearInterval(voiceTickerRef.current);
      voiceTickerRef.current = null;
    }
    setIsRecording(false);
  };

  const startOrRedoRecording = () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    voiceMsRef.current = 0;
    setRecordSeconds(0);
    setWaveform(Array.from({ length: 24 }, () => 6 + Math.round(Math.random() * 8)));
    setIsRecording(true);

    voiceTickerRef.current = setInterval(() => {
      voiceMsRef.current += 120;
      const seconds = Math.floor(voiceMsRef.current / 1000);
      setRecordSeconds(seconds);
      setWaveform((prev) => [...prev.slice(-39), 6 + Math.round(Math.random() * 18)]);
      if (voiceMsRef.current >= 30000) {
        stopRecording();
      }
    }, 120);
  };

  useEffect(() => {
    return () => {
      if (voiceTickerRef.current) clearInterval(voiceTickerRef.current);
      if (sessionBannerTimerRef.current) clearTimeout(sessionBannerTimerRef.current);
    };
  }, []);

  const stepTitle = useMemo(() => {
    switch (step) {
      case 1:
        return 'Phone number';
      case 2:
        return 'OTP';
      case 3:
        return 'Your name';
      case 4:
        return 'The basics';
      case 5:
        return 'Your vibe ✨';
      case 6:
        return 'Voice intro';
      case 7:
        return 'All set';
      default:
        return '';
    }
  }, [step]);

  if (!hasHydrated) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (isRestoringSession) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.restoringText}>Restoring your MiXiT session...</Text>
      </View>
    );
  }

  if (shouldShowProfileHome) {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 78 : 0}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets>
            <Text style={styles.profileTitle}>Profile</Text>
            <Text style={styles.profileSubtitle}>Manage your MiXiT details</Text>
            {showSessionRestoredBanner ? (
              <View style={styles.sessionBanner}>
                <Text style={styles.sessionBannerText}>Session restored. Welcome back.</Text>
              </View>
            ) : null}

            <View style={styles.profileCard}>
              <View style={styles.profileAvatar}>
                <Text style={styles.profileAvatarText}>{displayName.slice(0, 1).toUpperCase() || 'M'}</Text>
              </View>
              <Text style={styles.profileName}>{displayName}</Text>
              <Text style={styles.profilePhone}>{user?.phone ?? ''}</Text>
              <View style={styles.profileMetaRow}>
                <View style={styles.profileMetaPill}>
                  <Text style={styles.profileMetaText}>{age} years</Text>
                </View>
                <View style={styles.profileMetaPill}>
                  <Text style={styles.profileMetaText}>{gender}</Text>
                </View>
              </View>
            </View>

            {isEditingProfile ? (
              <View style={styles.stepBlock}>
                <Text style={styles.label}>Display Name</Text>
                <TextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="What people call you?"
                  placeholderTextColor="#8d90a6"
                  style={styles.input}
                />

                <Text style={styles.label}>Age: {age}</Text>
                <Slider
                  minimumValue={18}
                  maximumValue={80}
                  step={1}
                  value={age}
                  minimumTrackTintColor="#ff6b35"
                  maximumTrackTintColor="#303754"
                  thumbTintColor="#ff6b35"
                  onValueChange={(value) => setAge(value)}
                />

                <Text style={styles.label}>Gender</Text>
                <View style={styles.genderRow}>
                  {(['male', 'female', 'homesexual'] as Gender[]).map((option) => {
                    const active = gender === option;
                    return (
                      <Pressable
                        key={option}
                        style={[styles.pill, active && styles.pillActive]}
                        onPress={() => setGender(option)}>
                        <Text style={[styles.pillText, active && styles.pillTextActive]}>{option}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.label}>Interests</Text>
                <View style={styles.vibeGrid}>
                  {VIBE_OPTIONS.map((vibe) => {
                    const active = selectedVibes.includes(vibe);
                    return (
                      <Pressable
                        key={vibe}
                        style={[styles.vibeChip, active && styles.vibeChipActive]}
                        onPress={() => toggleVibe(vibe)}>
                        <Text style={[styles.vibeChipText, active && styles.vibeChipTextActive]}>{vibe}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.counterText}>{selectedVibes.length} selected</Text>

                <Pressable
                  style={[styles.button, (!canSaveProfile || saveProfileMutation.isPending) && styles.buttonDisabled]}
                  disabled={!canSaveProfile || saveProfileMutation.isPending}
                  onPress={() => saveProfileMutation.mutate()}>
                  <Text style={styles.buttonText}>
                    {saveProfileMutation.isPending ? 'Saving...' : 'Save profile'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.button, styles.secondaryButton]}
                  onPress={() => {
                    setIsEditingProfile(false);
                    const currentProfile = profileQuery.data;
                    if (currentProfile) {
                      setDisplayName(currentProfile.displayName ?? '');
                      setAge(currentProfile.age ?? 24);
                      setGender((currentProfile.gender as Gender) ?? 'female');
                      setSelectedVibes(parseInterests(currentProfile));
                    }
                  }}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.stepBlock}>
                <Text style={styles.label}>Interests</Text>
                <View style={styles.vibeGrid}>
                  {selectedVibes.length > 0 ? (
                    selectedVibes.map((vibe) => (
                      <View key={vibe} style={[styles.vibeChip, styles.vibeChipActive]}>
                        <Text style={[styles.vibeChipText, styles.vibeChipTextActive]}>{vibe}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.counterText}>No interests yet</Text>
                  )}
                </View>
                <Pressable style={styles.button} onPress={() => setIsEditingProfile(true)}>
                  <Text style={styles.buttonText}>Edit profile</Text>
                </Pressable>
              </View>
            )}

            <Pressable style={[styles.button, styles.secondaryButton]} onPress={handleLogout}>
              <Text style={styles.secondaryButtonText}>Log out</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 78 : 0}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets>
          <Progress step={step} />
          {step >= 3 && step <= 6 && (
            <Pressable onPress={() => setStep((prev) => clampStep(prev - 1))}>
              <Text style={styles.backLink}>← Back</Text>
            </Pressable>
          )}
          <Text style={styles.stepLabel}>Step {step} of 7</Text>
          <Text style={styles.title}>{stepTitle}</Text>
          <Text style={styles.caption}>
            {__DEV__ ? `Backend: ${API_BASE_URL}` : 'Warm. Fast. Honest.'}
          </Text>
          {showSessionRestoredBanner ? (
            <View style={styles.sessionBanner}>
              <Text style={styles.sessionBannerText}>Session restored. Welcome back.</Text>
            </View>
          ) : null}
          {stepError ? <Text style={styles.errorText}>{stepError}</Text> : null}

          <Animated.View style={{ transform: [{ translateX: slide }] }}>
            {step === 1 && (
              <View style={styles.stepBlock}>
                <Text style={styles.label}>Phone Number</Text>
                <TextInput
                  autoFocus
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+27..."
                  placeholderTextColor="#8d90a6"
                  style={styles.input}
                  keyboardType="phone-pad"
                />
                <Pressable
                  style={[styles.button, requestOtpMutation.isPending && styles.buttonDisabled]}
                  disabled={requestOtpMutation.isPending || phone.trim().length < 8}
                  onPress={() => requestOtpMutation.mutate(phone)}>
                  <Text style={styles.buttonText}>
                    {requestOtpMutation.isPending ? 'Sending...' : 'Send code'}
                  </Text>
                </Pressable>
              </View>
            )}

            {step === 2 && (
              <View style={styles.stepBlock}>
                <Text style={styles.label}>OTP Code</Text>
                <OtpBoxes code={otpCode} verified={otpVerified} />
                <TextInput
                  value={otpCode}
                  onChangeText={(v) => setOtpCode(v.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  style={styles.hiddenOtpInput}
                  autoFocus
                  maxLength={6}
                />
                <Pressable onPress={runResendAutofill} disabled={requestOtpMutation.isPending}>
                  <Text style={styles.link}>Resend code</Text>
                </Pressable>
              </View>
            )}

            {step === 3 && (
              <View style={styles.stepBlock}>
                <Text style={styles.label}>Display Name</Text>
                <TextInput
                  autoFocus
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="What people call you?"
                  placeholderTextColor="#8d90a6"
                  style={styles.input}
                />
                <View style={styles.suggestionRow}>
                  {NAME_SUGGESTIONS.map((name) => (
                    <Pressable key={name} style={styles.suggestionChip} onPress={() => setDisplayName(name)}>
                      <Text style={styles.suggestionText}>{name}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  style={[styles.button, !canProceedStep3 && styles.buttonDisabled]}
                  disabled={!canProceedStep3}
                  onPress={() => setStep(4)}>
                  <Text style={styles.buttonText}>Next</Text>
                </Pressable>
              </View>
            )}

            {step === 4 && (
              <View style={styles.stepBlock}>
                <Text style={styles.label}>Gender</Text>
                <View style={styles.genderRow}>
                  {(['male', 'female', 'homesexual'] as Gender[]).map((option) => {
                    const active = gender === option;
                    return (
                      <Pressable
                        key={option}
                        style={[styles.pill, active && styles.pillActive]}
                        onPress={() => setGender(option)}>
                        <Text style={[styles.pillText, active && styles.pillTextActive]}>{option}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.label}>Age: {age}</Text>
                <Slider
                  minimumValue={18}
                  maximumValue={80}
                  step={1}
                  value={age}
                  minimumTrackTintColor="#ff6b35"
                  maximumTrackTintColor="#303754"
                  thumbTintColor="#ff6b35"
                  onValueChange={(value) => setAge(value)}
                />
                <Pressable style={styles.button} onPress={() => setStep(5)}>
                  <Text style={styles.buttonText}>Next</Text>
                </Pressable>
              </View>
            )}

            {step === 5 && (
              <View style={styles.stepBlock}>
                <Text style={styles.label}>Pick at least 3 interests</Text>
                <View style={styles.vibeGrid}>
                  {VIBE_OPTIONS.map((vibe) => {
                    const active = selectedVibes.includes(vibe);
                    return (
                      <Pressable
                        key={vibe}
                        style={[styles.vibeChip, active && styles.vibeChipActive]}
                        onPress={() => toggleVibe(vibe)}>
                        <Text style={[styles.vibeChipText, active && styles.vibeChipTextActive]}>{vibe}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.counterText}>{selectedVibes.length} selected</Text>
                <Pressable
                  style={[styles.button, !canProceedStep5 && styles.buttonDisabled]}
                  disabled={!canProceedStep5}
                  onPress={() => setStep(6)}>
                  <Text style={styles.buttonText}>Next</Text>
                </Pressable>
              </View>
            )}

            {step === 6 && (
              <View style={styles.stepBlock}>
                <Text style={styles.label}>Record a 15-30 second intro</Text>
                <Pressable style={styles.recordButton} onPress={startOrRedoRecording}>
                  <Text style={styles.recordButtonText}>{isRecording ? 'Stop' : hasVoiceClip ? 'Redo' : 'Mic'}</Text>
                </Pressable>
                <Text style={styles.timerText}>{`0:${String(recordSeconds).padStart(2, '0')}`}</Text>
                <View style={styles.waveWrap}>
                  {waveform.map((h, i) => (
                    <View
                      key={`${i}-${h}`}
                      style={[
                        styles.waveBar,
                        { height: h },
                        !isRecording && hasVoiceClip && styles.waveBarRecorded,
                      ]}
                    />
                  ))}
                </View>
                <Pressable
                  style={[styles.button, (!hasVoiceClip || saveProfileMutation.isPending) && styles.buttonDisabled]}
                  disabled={!hasVoiceClip || saveProfileMutation.isPending}
                  onPress={() => saveProfileMutation.mutate()}>
                  <Text style={styles.buttonText}>
                    {saveProfileMutation.isPending ? 'Finishing...' : 'Finish setup'}
                  </Text>
                </Pressable>
              </View>
            )}

            {step === 7 && (
              <View style={styles.stepBlock}>
                <View style={styles.doneRing}>
                  <Text style={styles.doneCheck}>✓</Text>
                </View>
                <Text style={styles.doneTitle}>You are all set</Text>
                <Text style={styles.doneBody}>Profile completed. Start discovering people now.</Text>
                <Pressable
                  style={styles.button}
                  onPress={() => {
                    setShowCompletionStep(false);
                    router.replace('/(tabs)/discover');
                  }}>
                  <Text style={styles.buttonText}>Start discovering</Text>
                </Pressable>
                <Pressable style={[styles.button, styles.secondaryButton]} onPress={handleLogout}>
                  <Text style={styles.secondaryButtonText}>Log out</Text>
                </Pressable>
              </View>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0e1018',
  },
  flex: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 120,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0e1018',
  },
  restoringText: {
    color: '#aeb6d6',
    marginTop: 10,
    fontSize: 15,
    fontWeight: '600',
  },
  progressWrap: {
    marginTop: 6,
    marginBottom: 8,
    gap: 10,
  },
  progressSegments: {
    flexDirection: 'row',
    gap: 6,
  },
  segment: {
    height: 4,
    flex: 1,
    borderRadius: 4,
    backgroundColor: '#202640',
  },
  segmentActive: {
    backgroundColor: '#ff6b35',
  },
  bottomDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2a314d',
  },
  dotActive: {
    backgroundColor: '#ff6b35',
    width: 16,
  },
  stepLabel: {
    color: '#8f97bc',
    fontSize: 14,
    fontWeight: '600',
  },
  backLink: {
    color: '#9ca8ff',
    marginBottom: 6,
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    color: '#f7f8ff',
    fontSize: 34,
    fontWeight: '700',
    marginTop: 2,
  },
  profileTitle: {
    color: '#f7f8ff',
    fontSize: 34,
    fontWeight: '700',
  },
  profileSubtitle: {
    color: '#98a1c7',
    fontSize: 16,
    marginTop: 4,
    marginBottom: 10,
  },
  caption: {
    color: '#8c94b8',
    marginTop: 4,
    marginBottom: 8,
    fontSize: 13,
  },
  profileCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#252d49',
    backgroundColor: '#141a2c',
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  profileAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ff6b35',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  profileAvatarText: {
    color: '#10131d',
    fontSize: 30,
    fontWeight: '700',
  },
  profileName: {
    color: '#f7f8ff',
    fontSize: 28,
    fontWeight: '700',
  },
  profilePhone: {
    color: '#a8b0d0',
    marginTop: 4,
    marginBottom: 8,
    fontSize: 15,
    fontWeight: '600',
  },
  profileMetaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  profileMetaPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2a3148',
    backgroundColor: '#1a1f2e',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  profileMetaText: {
    color: '#d9dcf2',
    fontSize: 14,
    fontWeight: '600',
  },
  sessionBanner: {
    marginBottom: 10,
    backgroundColor: '#163126',
    borderWidth: 1,
    borderColor: '#22c67a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  sessionBannerText: {
    color: '#b8f0d5',
    fontSize: 13,
    fontWeight: '700',
  },
  errorText: {
    color: '#ff9d8c',
    fontSize: 14,
    marginBottom: 10,
    fontWeight: '600',
  },
  stepBlock: {
    gap: 10,
  },
  label: {
    color: '#d9dcf2',
    fontWeight: '600',
    marginTop: 8,
    fontSize: 18,
  },
  input: {
    backgroundColor: '#1a1f2e',
    color: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3148',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 24,
    fontWeight: '500',
  },
  button: {
    marginTop: 12,
    backgroundColor: '#ff6b35',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: '#10131d',
    fontWeight: '700',
    fontSize: 18,
  },
  link: {
    color: '#9ca8ff',
    marginTop: 8,
    textDecorationLine: 'underline',
    fontSize: 16,
  },
  otpRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  otpBox: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3148',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#171d2c',
  },
  otpBoxVerified: {
    borderColor: '#22c67a',
    backgroundColor: '#163126',
  },
  otpChar: {
    color: '#f7f8ff',
    fontSize: 24,
    fontWeight: '700',
  },
  hiddenOtpInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  suggestionChip: {
    borderWidth: 1,
    borderColor: '#2d3555',
    backgroundColor: '#1a2033',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  suggestionText: {
    color: '#d6dbf4',
    fontWeight: '600',
  },
  genderRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#1a1f2e',
    borderColor: '#2a3148',
    borderWidth: 1,
    borderRadius: 999,
  },
  pillActive: {
    backgroundColor: '#ff6b35',
    borderColor: '#ff6b35',
  },
  pillText: {
    color: '#d9dcf2',
    fontWeight: '600',
    fontSize: 15,
  },
  pillTextActive: {
    color: '#10131d',
  },
  vibeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  vibeChip: {
    width: '48.5%',
    borderWidth: 1,
    borderColor: '#323b60',
    backgroundColor: '#171e30',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
  },
  vibeChipActive: {
    borderColor: '#ff6b35',
    backgroundColor: '#2e1c1a',
  },
  vibeChipText: {
    color: '#c4cbe8',
    fontWeight: '600',
    fontSize: 16,
  },
  vibeChipTextActive: {
    color: '#ff6b35',
  },
  counterText: {
    color: '#a8b0d0',
    marginTop: 2,
    fontWeight: '600',
  },
  recordButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#ff6b35',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 8,
  },
  recordButtonText: {
    color: '#111524',
    fontWeight: '700',
    fontSize: 20,
  },
  timerText: {
    color: '#d8ddf5',
    textAlign: 'center',
    fontWeight: '700',
    fontSize: 24,
    marginTop: 6,
  },
  waveWrap: {
    height: 64,
    borderRadius: 12,
    backgroundColor: '#141a2b',
    borderWidth: 1,
    borderColor: '#2a3148',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
    overflow: 'hidden',
  },
  waveBar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: '#9aa3cb',
  },
  waveBarRecorded: {
    backgroundColor: '#ff6b35',
  },
  doneRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 4,
    borderColor: '#22c67a',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  doneCheck: {
    color: '#22c67a',
    fontSize: 42,
    fontWeight: '700',
  },
  doneTitle: {
    color: '#f6f8ff',
    textAlign: 'center',
    fontWeight: '700',
    fontSize: 32,
    marginTop: 8,
  },
  doneBody: {
    color: '#a5aecf',
    textAlign: 'center',
    fontSize: 17,
    lineHeight: 24,
  },
  secondaryButton: {
    backgroundColor: '#232a3f',
    marginTop: 8,
  },
  secondaryButtonText: {
    color: '#d9dcf2',
    fontWeight: '700',
    fontSize: 17,
  },
});
