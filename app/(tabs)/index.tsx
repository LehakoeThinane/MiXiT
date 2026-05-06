import Slider from '@react-native-community/slider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, API_BASE_URL } from '@/lib/api-client';
import { getCurrentUser, login, register } from '@/lib/auth-api';
import { getMyProfile, requestPhotoUploadUrl, uploadPhotoToStorage, upsertMyProfile } from '@/lib/profile-api';
import { useAuthStore } from '@/stores/auth-store';

type Gender = 'male' | 'female' | 'other';
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
const INTENT_OPTIONS = ['Chat', 'Friends', 'Something serious', 'Networking'] as const;

const clampStep = (value: number) => Math.max(1, Math.min(7, value)) as Step;

function getShortBio(rawBio: string | null | undefined) {
  const cleaned = rawBio?.trim() ?? '';
  if (cleaned && !/^into\s+/i.test(cleaned)) return cleaned;
  return '';
}

function formatLastSeenLabel(lastActive?: string | null) {
  if (!lastActive) return 'Active recently';
  const timestamp = new Date(lastActive).getTime();
  if (Number.isNaN(timestamp)) return 'Active recently';
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));
  if (diffMinutes <= 5) return 'Active now';
  if (diffMinutes < 60) return `Last seen ${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `Last seen ${diffHours}h ago`;
  return `Last seen ${Math.floor(diffHours / 24)}d ago`;
}

function parseInterestsFromBio(bio?: string | null) {
  if (!bio) return [];
  if (!/^into\s+/i.test(bio.trim())) return [];
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

function parseStringList(value?: string[] | null) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
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

export default function ProfileTabScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const slide = useRef(new Animated.Value(0)).current;
  const orbA = useRef(new Animated.Value(0)).current;
  const orbB = useRef(new Animated.Value(0)).current;
  const orbC = useRef(new Animated.Value(0)).current;
  const orbD = useRef(new Animated.Value(0)).current;
  const voiceTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceMsRef = useRef(0);
  const sessionBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didShowSessionBannerRef = useRef(false);

  const { hasHydrated, user, accessToken, refreshToken, setSession, clearSession } = useAuthStore();
  const isAuthenticated = Boolean(accessToken && user);
  const hasSessionTokens = Boolean(accessToken && refreshToken);

  const [step, setStep] = useState<Step>(1);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  const [displayName, setDisplayName] = useState('');
  const [age, setAge] = useState(24);
  const [gender, setGender] = useState<Gender>('female');
  const [bioInput, setBioInput] = useState('');
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [selectedIntents, setSelectedIntents] = useState<string[]>([]);
  const [traitsText, setTraitsText] = useState('');
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [showPhone, setShowPhone] = useState(true);
  const [showLastSeen, setShowLastSeen] = useState(true);
  const [uploadingPhotoIndex, setUploadingPhotoIndex] = useState<number | null>(null);

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
    const createLoop = (value: Animated.Value, duration: number, delayMs = 0) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delayMs),
          Animated.timing(value, {
            toValue: 1,
            duration,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );

    const loops = [
      createLoop(orbA, 18000, 0),
      createLoop(orbB, 22000, 900),
      createLoop(orbC, 20000, 1400),
      createLoop(orbD, 24000, 500),
    ];

    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [orbA, orbB, orbC, orbD]);

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
    setBioInput(profile.bio ?? '');
    setSelectedVibes(parseInterests(profile));
    setSelectedIntents(parseStringList(profile.intents).slice(0, 4));
    setTraitsText(parseStringList(profile.traits).join('\n'));
    setSelectedPhotos(parseStringList(profile.photos).slice(0, 3));
    setShowPhone(profile.showPhone ?? true);
    setShowLastSeen(profile.showLastSeen ?? true);
  }, [profileQuery.data]);

  const authMutation = useMutation({
    mutationFn: ({ inputPhone, inputPassword, mode }: { inputPhone: string; inputPassword: string; mode: 'login' | 'register' }) =>
      mode === 'register' ? register(inputPhone, inputPassword) : login(inputPhone, inputPassword),
    onSuccess: async (payload) => {
      setStepError(null);
      setSession({
        user: payload.user,
        accessToken: payload.tokens.accessToken,
        refreshToken: payload.tokens.refreshToken,
      });
      setStep(3);
      await queryClient.invalidateQueries({ queryKey: ['profile', payload.user.id] });
    },
    onError: (error) => {
      const message = resolveErrorMessage(error);
      setStepError(message);
      Alert.alert('Sign in failed', message);
    },
  });

  const saveProfileMutation = useMutation({
    mutationFn: async () =>
      upsertMyProfile({
        displayName: displayName.trim(),
        age,
        gender,
        bio: bioInput.trim(),
        interests: selectedVibes,
        intents: selectedIntents,
        traits: traitsText
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 5),
        photos: selectedPhotos.slice(0, 3),
        showPhone,
        showLastSeen,
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
  const primaryPhoto = selectedPhotos[0] ?? null;
  const mediaItems = [0, 1, 2].map((index) => selectedPhotos[index] ?? null);
  const shortBio = getShortBio(bioInput || profileQuery.data?.bio);
  const intentOptions = selectedIntents;
  const isActiveNow = showLastSeen && formatLastSeenLabel(profileQuery.data?.lastActive) === 'Active now';
  const lastSeenLabel = showLastSeen ? formatLastSeenLabel(profileQuery.data?.lastActive) : 'Last seen hidden';
  const joinedLabel = profileQuery.data?.joinedAt ? `Joined ${new Date(profileQuery.data.joinedAt).getFullYear()}` : '';
  const roomsParticipated = profileQuery.data?.roomsParticipated ?? null;
  const identityInterests = selectedVibes;
  const personalityTraits = traitsText
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);

  const toggleVibe = (vibe: string) => {
    setSelectedVibes((prev) => {
      if (prev.includes(vibe)) return prev.filter((v) => v !== vibe);
      if (prev.length >= 8) return prev;
      return [...prev, vibe];
    });
  };

  const toggleIntent = (intent: string) => {
    setSelectedIntents((prev) => {
      if (prev.includes(intent)) return prev.filter((item) => item !== intent);
      if (prev.length >= 4) return prev;
      return [...prev, intent];
    });
  };

  const pickPhotoAt = async (index: number) => {
    if (uploadingPhotoIndex !== null) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo access to add profile images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: false,
    });

    if (result.canceled || !result.assets.length) return;

    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? 'image/jpeg';
    const filename = asset.fileName ?? `photo-${Date.now()}.jpg`;

    setUploadingPhotoIndex(index);
    try {
      const { signedUrl, publicUrl } = await requestPhotoUploadUrl(filename, mimeType);
      await uploadPhotoToStorage(signedUrl, asset.uri, mimeType);
      setSelectedPhotos((prev) => {
        const next = [...prev];
        next[index] = publicUrl;
        return next.slice(0, 3);
      });
    } catch {
      Alert.alert('Upload failed', 'Could not upload photo. Please try again.');
    } finally {
      setUploadingPhotoIndex(null);
    }
  };

  const removePhotoAt = (index: number) => {
    setSelectedPhotos((prev) => prev.filter((_, position) => position !== index));
  };

  const handleLogout = () => {
    clearSession();
    setStep(1);
    setPhone('');
    setPassword('');
    setDisplayName('');
    setAge(24);
    setGender('female');
    setBioInput('');
    setSelectedVibes([]);
    setSelectedIntents([]);
    setTraitsText('');
    setSelectedPhotos([]);
    setShowPhone(true);
    setShowLastSeen(true);
    setIsRecording(false);
    setRecordSeconds(0);
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
        return authMode === 'register' ? 'Create account' : 'Sign in';
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

  const liquidBackdrop = (
    <View pointerEvents="none" style={styles.liquidBackground}>
      <Animated.View
        style={[
          styles.orb,
          styles.orbCoral,
          {
            transform: [
              { translateX: orbA.interpolate({ inputRange: [0, 1], outputRange: [-20, 36] }) },
              { translateY: orbA.interpolate({ inputRange: [0, 1], outputRange: [-16, 48] }) },
              { scale: orbA.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.orb,
          styles.orbNavy,
          {
            transform: [
              { translateX: orbB.interpolate({ inputRange: [0, 1], outputRange: [24, -40] }) },
              { translateY: orbB.interpolate({ inputRange: [0, 1], outputRange: [18, -38] }) },
              { scale: orbB.interpolate({ inputRange: [0, 1], outputRange: [1.1, 0.92] }) },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.orb,
          styles.orbRose,
          {
            transform: [
              { translateX: orbC.interpolate({ inputRange: [0, 1], outputRange: [-12, 28] }) },
              { translateY: orbC.interpolate({ inputRange: [0, 1], outputRange: [24, -44] }) },
              { scale: orbC.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.16] }) },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.orb,
          styles.orbTeal,
          {
            transform: [
              { translateX: orbD.interpolate({ inputRange: [0, 1], outputRange: [18, -34] }) },
              { translateY: orbD.interpolate({ inputRange: [0, 1], outputRange: [-26, 36] }) },
              { scale: orbD.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1.22] }) },
            ],
          },
        ]}
      />
      <View style={styles.liquidScrim} />
    </View>
  );

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
        {liquidBackdrop}
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 78 : 0}>
          <ScrollView
            contentContainerStyle={styles.profileContent}
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
              <View style={styles.profileHeaderRow}>
                {primaryPhoto ? (
                  <Image source={{ uri: primaryPhoto }} style={styles.profilePhoto} contentFit="cover" />
                ) : (
                  <View style={styles.profileAvatar}>
                    <Text style={styles.profileAvatarText}>{displayName.slice(0, 1).toUpperCase() || 'M'}</Text>
                  </View>
                )}
                <View style={styles.profileIdentityBlock}>
                  <Text style={styles.profileName}>{displayName}</Text>
                  {showPhone ? <Text style={styles.profilePhone}>{user?.phone ?? ''}</Text> : null}
                  <View style={styles.statusRow}>
                    <View style={[styles.statusDot, isActiveNow && styles.statusDotActive]} />
                    <Text style={styles.statusText}>{lastSeenLabel}</Text>
                  </View>
                  {profileQuery.data?.city ? <Text style={styles.profileCity}>{profileQuery.data.city}</Text> : null}
                </View>
              </View>
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
                  {(['male', 'female', 'other'] as Gender[]).map((option) => {
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

                <Text style={styles.label}>Bio (1-2 lines)</Text>
                <TextInput
                  value={bioInput}
                  onChangeText={(value) => setBioInput(value.slice(0, 120))}
                  placeholder="Add a short bio"
                  placeholderTextColor="#8d90a6"
                  multiline
                  style={[styles.input, styles.bioInput]}
                />

                <Text style={styles.label}>Looking for</Text>
                <View style={styles.intentRow}>
                  {INTENT_OPTIONS.map((intent) => {
                    const active = selectedIntents.includes(intent);
                    return (
                      <Pressable
                        key={intent}
                        style={[styles.intentChip, active && styles.intentChipActive]}
                        onPress={() => toggleIntent(intent)}>
                        <Text style={[styles.intentText, active && styles.intentTextActive]}>{intent}</Text>
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

                <Text style={styles.label}>Personality traits</Text>
                <TextInput
                  value={traitsText}
                  onChangeText={(value) => setTraitsText(value.slice(0, 400))}
                  placeholder={'Pet peeve: slow WiFi\nGo-to topic: business + tech'}
                  placeholderTextColor="#8d90a6"
                  multiline
                  style={[styles.input, styles.traitsInput]}
                />

                <Text style={styles.label}>Media</Text>
                <View style={styles.mediaRow}>
                  {mediaItems.map((uri, index) => (
                    <View key={`${uri ?? 'slot-edit'}-${index}`} style={styles.mediaEditorCell}>
                      <Pressable
                        style={styles.mediaTile}
                        onPress={() => pickPhotoAt(index)}
                        disabled={uploadingPhotoIndex !== null}>
                        {uploadingPhotoIndex === index ? (
                          <ActivityIndicator color="#ff6b35" />
                        ) : uri ? (
                          <Image source={{ uri }} style={styles.mediaImage} contentFit="cover" />
                        ) : (
                          <Text style={styles.mediaPlaceholder}>Add photo</Text>
                        )}
                      </Pressable>
                      {uri && uploadingPhotoIndex !== index ? (
                        <Pressable style={styles.mediaAction} onPress={() => removePhotoAt(index)}>
                          <Text style={styles.mediaActionText}>Remove</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>

                <Text style={styles.label}>Privacy</Text>
                <View style={styles.toggleGroup}>
                  <Pressable style={[styles.pill, showPhone && styles.pillActive]} onPress={() => setShowPhone((prev) => !prev)}>
                    <Text style={[styles.pillText, showPhone && styles.pillTextActive]}>
                      {showPhone ? 'Phone visible' : 'Phone hidden'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.pill, showLastSeen && styles.pillActive]}
                    onPress={() => setShowLastSeen((prev) => !prev)}>
                    <Text style={[styles.pillText, showLastSeen && styles.pillTextActive]}>
                      {showLastSeen ? 'Last seen visible' : 'Last seen hidden'}
                    </Text>
                  </Pressable>
                </View>

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
                      setBioInput(currentProfile.bio ?? '');
                      setSelectedVibes(parseInterests(currentProfile));
                      setSelectedIntents(parseStringList(currentProfile.intents).slice(0, 4));
                      setTraitsText(parseStringList(currentProfile.traits).join('\n'));
                      setSelectedPhotos(parseStringList(currentProfile.photos).slice(0, 3));
                      setShowPhone(currentProfile.showPhone ?? true);
                      setShowLastSeen(currentProfile.showLastSeen ?? true);
                    }
                  }}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.profileStack}>
                <View style={styles.stepBlock}>
                  <Text style={styles.sectionTitle}>Bio</Text>
                  <Text style={styles.bodyText}>{shortBio || 'No bio yet'}</Text>
                </View>

                <View style={styles.stepBlock}>
                  <Text style={styles.sectionTitle}>Looking for</Text>
                  {intentOptions.length > 0 ? (
                    <View style={styles.intentRow}>
                      {intentOptions.map((intent) => (
                        <View key={intent} style={styles.intentChip}>
                          <Text style={styles.intentText}>{intent}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.supportText}>Not set</Text>
                  )}
                </View>

                <View style={styles.stepBlock}>
                  <Text style={styles.sectionTitle}>Vibe / Activity</Text>
                  <Text style={styles.bodyText}>{lastSeenLabel}</Text>
                  <Text style={styles.supportText}>
                    {showPhone ? 'Phone visible on profile' : 'Phone hidden on profile'}
                  </Text>
                </View>

                <View style={styles.stepBlock}>
                  <Text style={styles.sectionTitle}>Social proof</Text>
                  <View style={styles.socialProofRow}>
                    {joinedLabel ? (
                      <View style={styles.socialProofCard}>
                        <Text style={styles.socialProofTitle}>{joinedLabel}</Text>
                      </View>
                    ) : null}
                    {roomsParticipated !== null ? (
                      <View style={styles.socialProofCard}>
                        <Text style={styles.socialProofTitle}>{roomsParticipated} rooms participated</Text>
                      </View>
                    ) : null}
                  </View>
                  {!joinedLabel && roomsParticipated === null ? <Text style={styles.supportText}>No activity yet</Text> : null}
                </View>

                <View style={styles.stepBlock}>
                  <Text style={styles.sectionTitle}>Interests</Text>
                  {identityInterests.length > 0 ? (
                    identityInterests.map((line) => (
                      <View key={line} style={styles.identityLineWrap}>
                        <Text style={styles.identityLine}>• {line}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.counterText}>No interests yet</Text>
                  )}
                </View>

                <View style={styles.stepBlock}>
                  <Text style={styles.sectionTitle}>Media</Text>
                  <View style={styles.mediaRow}>
                    {mediaItems.map((uri, index) => (
                      <View key={`${uri ?? 'slot'}-${index}`} style={styles.mediaTile}>
                        {uri ? (
                          <Image source={{ uri }} style={styles.mediaImage} contentFit="cover" />
                        ) : (
                          <Text style={styles.mediaPlaceholder}>Add photo</Text>
                        )}
                      </View>
                    ))}
                  </View>
                </View>

                <View style={styles.stepBlock}>
                  <Text style={styles.sectionTitle}>Conversation starters</Text>
                  {personalityTraits.length > 0 ? (
                    personalityTraits.map((trait) => (
                      <Text key={trait} style={styles.identityLine}>
                        • {trait}
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.supportText}>No traits added yet</Text>
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
      {liquidBackdrop}
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
                <View style={styles.authModeRow}>
                  <Pressable
                    style={[styles.authModeTab, authMode === 'login' && styles.authModeTabActive]}
                    onPress={() => { setAuthMode('login'); setStepError(null); }}>
                    <Text style={[styles.authModeText, authMode === 'login' && styles.authModeTextActive]}>Sign in</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.authModeTab, authMode === 'register' && styles.authModeTabActive]}
                    onPress={() => { setAuthMode('register'); setStepError(null); }}>
                    <Text style={[styles.authModeText, authMode === 'register' && styles.authModeTextActive]}>Create account</Text>
                  </Pressable>
                </View>
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
                <Text style={styles.label}>Password</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Min 6 characters"
                  placeholderTextColor="#8d90a6"
                  style={styles.input}
                  secureTextEntry
                />
                <Pressable
                  style={[styles.button, authMutation.isPending && styles.buttonDisabled]}
                  disabled={authMutation.isPending || phone.trim().length < 8 || password.length < 6}
                  onPress={() => authMutation.mutate({ inputPhone: phone, inputPassword: password, mode: authMode })}>
                  <Text style={styles.buttonText}>
                    {authMutation.isPending
                      ? authMode === 'register' ? 'Creating...' : 'Signing in...'
                      : authMode === 'register' ? 'Create account' : 'Sign in'}
                  </Text>
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
                  {(['male', 'female', 'other'] as Gender[]).map((option) => {
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
              <View style={[styles.stepBlock, styles.stepBlockStrong]}>
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
    backgroundColor: '#060710',
  },
  liquidBackground: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  liquidScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7, 9, 20, 0.60)',
  },
  orb: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    opacity: 0.52,
  },
  orbCoral: {
    top: -120,
    left: -40,
    backgroundColor: '#ff6b35',
  },
  orbNavy: {
    top: 80,
    right: -110,
    backgroundColor: '#2d3561',
  },
  orbRose: {
    bottom: 120,
    left: 12,
    backgroundColor: '#9f4f77',
  },
  orbTeal: {
    bottom: -90,
    right: -36,
    backgroundColor: '#06d6a0',
  },
  flex: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 120,
  },
  profileContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 156,
    gap: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#060710',
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
    backgroundColor: 'rgba(255,255,255,0.15)',
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
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  dotActive: {
    backgroundColor: '#ff6b35',
    width: 16,
  },
  stepLabel: {
    color: '#b6bdd8',
    fontSize: 14,
    fontWeight: '600',
  },
  backLink: {
    color: '#d2d8ff',
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
    color: '#c2c7dc',
    marginTop: 4,
    marginBottom: 8,
    fontSize: 13,
  },
  profileCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.13)',
    padding: 16,
    marginBottom: 12,
  },
  profileHeaderRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  profilePhoto: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  profileAvatar: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: '#ff6b35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileIdentityBlock: {
    flex: 1,
    gap: 2,
  },
  profileAvatarText: {
    color: '#10131d',
    fontSize: 34,
    fontWeight: '700',
  },
  profileName: {
    color: '#f7f8ff',
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 44,
  },
  profilePhone: {
    color: '#d2d6ea',
    marginTop: 2,
    fontSize: 16,
    fontWeight: '600',
  },
  profileCity: {
    color: '#d0d5ec',
    fontSize: 14,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  statusDotActive: {
    backgroundColor: '#22c67a',
  },
  statusText: {
    color: '#d9dcf2',
    fontSize: 13,
    fontWeight: '600',
  },
  profileMetaRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  profileMetaPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(255,255,255,0.1)',
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
    backgroundColor: 'rgba(15, 86, 58, 0.42)',
    borderWidth: 1,
    borderColor: 'rgba(34,198,122,0.72)',
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
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  profileStack: {
    gap: 12,
  },
  sectionTitle: {
    color: '#f7f8ff',
    fontSize: 18,
    fontWeight: '700',
  },
  bodyText: {
    color: '#dbe0f3',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
  },
  supportText: {
    color: '#bbc3e4',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  intentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  intentChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(255,255,255,0.11)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  intentChipActive: {
    borderColor: 'rgba(255,184,160,0.9)',
    backgroundColor: 'rgba(255,107,53,0.32)',
  },
  intentText: {
    color: '#e7ebff',
    fontSize: 14,
    fontWeight: '700',
  },
  intentTextActive: {
    color: '#ffb193',
  },
  toggleGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  socialProofRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  socialProofCard: {
    flexGrow: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  socialProofTitle: {
    color: '#e2e7fb',
    fontSize: 14,
    fontWeight: '700',
  },
  identityLineWrap: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  identityLine: {
    color: '#dbe0f3',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  mediaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  mediaEditorCell: {
    flex: 1,
    gap: 6,
  },
  mediaTile: {
    flex: 1,
    height: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  mediaPlaceholder: {
    color: '#c8cfe9',
    fontWeight: '700',
    fontSize: 13,
  },
  mediaAction: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.09)',
    paddingVertical: 6,
    alignItems: 'center',
  },
  mediaActionText: {
    color: '#d9dff6',
    fontSize: 12,
    fontWeight: '700',
  },
  stepBlockStrong: {
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  label: {
    color: '#d9dcf2',
    fontWeight: '600',
    marginTop: 8,
    fontSize: 18,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 24,
    fontWeight: '500',
  },
  bioInput: {
    minHeight: 78,
    maxHeight: 120,
    textAlignVertical: 'top',
    fontSize: 18,
    lineHeight: 24,
  },
  traitsInput: {
    minHeight: 90,
    maxHeight: 160,
    textAlignVertical: 'top',
    fontSize: 16,
    lineHeight: 22,
  },
  button: {
    marginTop: 12,
    backgroundColor: 'rgba(255,107,53,0.78)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: '#151722',
    fontWeight: '700',
    fontSize: 18,
  },
  authModeRow: {
    flexDirection: 'row' as const,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: 3,
    marginBottom: 18,
  },
  authModeTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center' as const,
  },
  authModeTabActive: {
    backgroundColor: '#ff6b35',
  },
  authModeText: {
    color: '#9ca3c4',
    fontWeight: '600' as const,
    fontSize: 14,
  },
  authModeTextActive: {
    color: '#fff',
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  suggestionChip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.08)',
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
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderRadius: 999,
  },
  pillActive: {
    backgroundColor: 'rgba(255,107,53,0.68)',
    borderColor: 'rgba(255,201,182,0.72)',
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
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
  },
  vibeChipActive: {
    borderColor: 'rgba(255,184,160,0.8)',
    backgroundColor: 'rgba(255,107,53,0.32)',
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
    color: '#d2d7ec',
    marginTop: 2,
    fontWeight: '600',
  },
  recordButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255,107,53,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.36)',
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
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
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
    color: '#d7dbeb',
    textAlign: 'center',
    fontSize: 17,
    lineHeight: 24,
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.24)',
    marginTop: 8,
  },
  secondaryButtonText: {
    color: '#d9dcf2',
    fontWeight: '700',
    fontSize: 17,
  },
});
