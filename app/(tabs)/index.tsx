import { GoogleSignin } from '@react-native-google-signin/google-signin';
import Slider from '@react-native-community/slider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Audio } from 'expo-av';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
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
import {
  appleSignIn,
  deleteAccount,
  getCurrentUser,
  googleSignIn,
  logoutSession,
  reviewSignIn,
  updatePhone,
} from '@/lib/auth-api';
import { openLegalPage } from '@/lib/legal';
import { registerForPushNotifications } from '@/lib/notifications';
import {
  getMyProfile,
  requestPhotoUploadUrl,
  requestVoiceIntroUploadUrl,
  uploadPhotoToStorage,
  upsertMyProfile,
} from '@/lib/profile-api';
import { resetPurchasesUser } from '@/lib/purchases';
import { useAuthStore } from '@/stores/auth-store';

// Matches the backend profile schema (voiceIntroDurationSec 15–30).
const VOICE_INTRO_MIN_SEC = 15;
const VOICE_INTRO_MAX_SEC = 30;

type Gender = 'male' | 'female' | 'other';
type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
const isGoogleSignInConfigured = Boolean(GOOGLE_WEB_CLIENT_ID);

if (isGoogleSignInConfigured) {
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
  });
}

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
  const recordingRef = useRef<Audio.Recording | null>(null);
  const voiceMsRef = useRef(0);
  const sessionBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didShowSessionBannerRef = useRef(false);

  const { hasHydrated, user, accessToken, refreshToken, setSession, clearSession } = useAuthStore();
  const isAuthenticated = Boolean(accessToken && user);
  const hasSessionTokens = Boolean(accessToken && refreshToken);

  const [step, setStep] = useState<Step>(1);
  const [onboardingPhone, setOnboardingPhone] = useState('');
  const [phoneSaveError, setPhoneSaveError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [age, setAge] = useState(24);
  const [gender, setGender] = useState<Gender>('female');
  const [bioInput, setBioInput] = useState('');
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [selectedIntents, setSelectedIntents] = useState<string[]>([]);
  const [traitsText, setTraitsText] = useState('');
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [cityInput, setCityInput] = useState('');
  const [showPhone, setShowPhone] = useState(true);
  const [showLastSeen, setShowLastSeen] = useState(true);
  const [uploadingPhotoIndex, setUploadingPhotoIndex] = useState<number | null>(null);
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | null>(null);
  const locationRequestedRef = useRef(false);

  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [waveform, setWaveform] = useState<number[]>(Array.from({ length: 24 }, () => 8));
  // A new local recording waiting to be uploaded on save, or the already-saved intro.
  const [pendingVoiceUri, setPendingVoiceUri] = useState<string | null>(null);
  const [savedVoiceIntro, setSavedVoiceIntro] = useState<{ url: string; durationSec: number } | null>(null);
  const hasVoiceClip = !isRecording && Boolean(pendingVoiceUri || savedVoiceIntro);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isAppleSignInAvailable, setIsAppleSignInAvailable] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [showReviewLogin, setShowReviewLogin] = useState(false);
  const [reviewEmail, setReviewEmail] = useState('');
  const [reviewPassword, setReviewPassword] = useState('');
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
      // Only end the session when the server actually rejected it — not when the
      // phone is offline or the API is temporarily down.
      const status = sessionQuery.error instanceof ApiError ? sessionQuery.error.status : 0;
      if (status === 401 || status === 403) {
        clearSession();
        setStep(1);
        setStepError(
          status === 403 ? 'Your account has been suspended.' : 'Your session expired. Please sign in again.'
        );
      } else {
        setStepError(resolveErrorMessage(sessionQuery.error));
      }
      return;
    }

    if (sessionQuery.data?.user && accessToken && refreshToken) {
      setSession({
        user: {
          id: sessionQuery.data.user.id,
          email: sessionQuery.data.user.email,
          phone: sessionQuery.data.user.phone,
        },
        accessToken,
        refreshToken,
      });
    }
  }, [accessToken, clearSession, refreshToken, sessionQuery.data, sessionQuery.error, sessionQuery.isError, setSession]);

  // Keep the phone editor in sync with the persisted value — only reacts to the
  // phone value itself changing, so it won't clobber an in-progress edit.
  useEffect(() => {
    setOnboardingPhone(user?.phone ?? '');
  }, [user?.phone]);

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
    if (isEditingProfile) return;

    const profile = profileQuery.data;
    setDisplayName(profile.displayName ?? '');
    setAge(profile.age ?? 24);
    setGender((profile.gender as Gender) ?? 'female');
    setBioInput(profile.bio ?? '');
    setCityInput(profile.city ?? '');
    setSelectedVibes(parseInterests(profile));
    setSelectedIntents(parseStringList(profile.intents).slice(0, 4));
    setTraitsText(parseStringList(profile.traits).join('\n'));
    setSelectedPhotos(parseStringList(profile.photos).slice(0, 3));
    setShowPhone(profile.showPhone ?? true);
    setShowLastSeen(profile.showLastSeen ?? true);
    setSavedVoiceIntro(
      profile.voiceIntroUrl && profile.voiceIntroDurationSec
        ? { url: profile.voiceIntroUrl, durationSec: profile.voiceIntroDurationSec }
        : null
    );
    setPendingVoiceUri(null);
    if (profile.locationLat != null && profile.locationLng != null) {
      setLocationCoords((prev) => prev ?? { lat: profile.locationLat as number, lng: profile.locationLng as number });
    }
  }, [profileQuery.data, isEditingProfile]);

  // Request GPS once the user has an identity (step 4+) or opens edit — silently
  // falls back to city-based distance in Discover if permission is denied.
  useEffect(() => {
    if (locationRequestedRef.current) return;
    if (!isAuthenticated) return;
    if (locationCoords) return;
    if (step < 4 && !isEditingProfile) return;

    locationRequestedRef.current = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLocationCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
      } catch {
        // permission denied or location services unavailable — city-based distance still works
      }
    })();
  }, [step, isEditingProfile, isAuthenticated, locationCoords]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync()
      .then(setIsAppleSignInAvailable)
      .catch(() => setIsAppleSignInAvailable(false));
  }, []);

  const authCallbacks = {
    onSuccess: async (payload: Awaited<ReturnType<typeof googleSignIn>>) => {
      setStepError(null);
      setSession({
        user: payload.user,
        accessToken: payload.tokens.accessToken,
        refreshToken: payload.tokens.refreshToken,
      });
      setStep(3);
      await queryClient.invalidateQueries({ queryKey: ['profile', payload.user.id] });
    },
    onError: (error: unknown) => {
      const message = resolveErrorMessage(error);
      setStepError(message);
      Alert.alert('Sign in failed', message);
    },
  };

  const googleAuthMutation = useMutation({
    mutationFn: (idToken: string) => googleSignIn(idToken, acceptedTerms),
    ...authCallbacks,
  });

  const appleAuthMutation = useMutation({
    mutationFn: (identityToken: string) => appleSignIn(identityToken, acceptedTerms),
    ...authCallbacks,
  });

  const reviewAuthMutation = useMutation({
    mutationFn: () => reviewSignIn(reviewEmail.trim(), reviewPassword),
    ...authCallbacks,
  });

  const isSigningIn = googleAuthMutation.isPending || appleAuthMutation.isPending || reviewAuthMutation.isPending;

  const handleAppleSignIn = async () => {
    if (!acceptedTerms) return;
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        setStepError('Apple did not return a sign-in token. Please try again.');
        return;
      }
      // Apple only shares the name on the very first sign-in — use it as a suggestion.
      const givenName = credential.fullName?.givenName?.trim();
      if (givenName && !displayName) setDisplayName(givenName.slice(0, 30));
      appleAuthMutation.mutate(credential.identityToken);
    } catch (error) {
      if ((error as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return;
      setStepError(resolveErrorMessage(error));
    }
  };

  const updatePhoneMutation = useMutation({
    mutationFn: (value: string) => updatePhone(value),
    onSuccess: (result) => {
      setPhoneSaveError(null);
      if (user && accessToken && refreshToken) {
        setSession({ user: { ...user, phone: result.phone }, accessToken, refreshToken });
      }
    },
    onError: (error) => {
      setPhoneSaveError(resolveErrorMessage(error));
    },
  });

  const savePhoneIfChanged = () => {
    const trimmed = onboardingPhone.trim();
    if (trimmed && trimmed !== (user?.phone ?? '')) {
      updatePhoneMutation.mutate(trimmed);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!acceptedTerms) return;
    try {
      if (Platform.OS === 'android') {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      }
      const response = await GoogleSignin.signIn();
      if (response.type !== 'success' || !response.data.idToken) {
        return; // user cancelled, or no idToken returned — nothing to do
      }
      googleAuthMutation.mutate(response.data.idToken);
    } catch (error) {
      setStepError(resolveErrorMessage(error));
    }
  };

  // Uploads a freshly recorded intro; otherwise keeps the saved one (the backend
  // clears the intro when these fields are omitted).
  const resolveVoiceIntroForSave = async (): Promise<{ url: string; durationSec: number } | null> => {
    if (!pendingVoiceUri) return savedVoiceIntro;
    const durationSec = Math.min(VOICE_INTRO_MAX_SEC, Math.max(VOICE_INTRO_MIN_SEC, recordSeconds));
    const { signedUrl, publicUrl } = await requestVoiceIntroUploadUrl();
    await uploadPhotoToStorage(signedUrl, pendingVoiceUri, 'audio/m4a');
    const uploaded = { url: publicUrl, durationSec };
    setSavedVoiceIntro(uploaded);
    setPendingVoiceUri(null);
    return uploaded;
  };

  const saveProfileMutation = useMutation({
    mutationFn: async (fromEditProfile: boolean) => {
      const voiceIntro = await resolveVoiceIntroForSave();
      return upsertMyProfile({
        voiceIntroUrl: voiceIntro?.url,
        voiceIntroDurationSec: voiceIntro?.durationSec,
        displayName: displayName.trim(),
        age,
        gender,
        bio: bioInput.trim(),
        city: cityInput.trim() || undefined,
        locationLat: locationCoords?.lat,
        locationLng: locationCoords?.lng,
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
      });
    },
    onSuccess: async (_data, fromEditProfile) => {
      setStepError(null);
      await queryClient.invalidateQueries({ queryKey: ['profile', user?.id] });
      if (fromEditProfile) {
        setIsEditingProfile(false);
      } else {
        setShowCompletionStep(true);
        setStep(7);
      }
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

  const profileCompleteness = useMemo(() => {
    const p = profileQuery.data;
    if (!p) return 0;
    const checks = [
      Boolean(p.displayName),
      Boolean(p.bio?.trim()),
      Boolean(p.city?.trim()),
      ((p.photos as string[] | null) ?? []).length > 0,
      ((p.interests as string[] | null) ?? []).length > 0,
      ((p.intents as string[] | null) ?? []).length > 0,
      Boolean(p.voiceIntroUrl),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [profileQuery.data]);
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

    // No media-library permission needed: the system photo picker grants one-off
    // access (Google Play photo/video permission policy).
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: false,
    });

    if (result.canceled || !result.assets.length) return;

    const asset = result.assets[0];
    // Normalise Android aliases before sending to the backend
    const rawMime = asset.mimeType ?? 'image/jpeg';
    const mimeType = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
    const ext = mimeType.split('/')[1] ?? 'jpg';
    const filename = asset.fileName ?? `photo-${Date.now()}.${ext}`;

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

  // ---- Voice intro: real recording via expo-av, uploaded when the profile is saved ----
  const finishRecording = async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    recordingRef.current = null;
    try {
      await recording.stopAndUnloadAsync();
    } catch {
      // already stopped
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => undefined);
    setIsRecording(false);

    const seconds = Math.floor(voiceMsRef.current / 1000);
    const uri = recording.getURI();
    if (!uri) return;
    if (seconds < VOICE_INTRO_MIN_SEC) {
      setRecordSeconds(0);
      setPendingVoiceUri(null);
      Alert.alert('Too short', `Voice intros need to be at least ${VOICE_INTRO_MIN_SEC} seconds. Tap the mic to try again.`);
      return;
    }
    setRecordSeconds(Math.min(seconds, VOICE_INTRO_MAX_SEC));
    setPendingVoiceUri(uri);
  };

  const onRecordingStatus = (status: Audio.RecordingStatus) => {
    if (!status.isRecording) return;
    voiceMsRef.current = status.durationMillis;
    setRecordSeconds(Math.floor(status.durationMillis / 1000));
    const level = typeof status.metering === 'number' ? status.metering : -60; // dBFS, -160..0
    const height = 6 + Math.round(Math.max(0, Math.min(1, (level + 60) / 60)) * 22);
    setWaveform((prev) => [...prev.slice(-39), height]);
    if (status.durationMillis >= VOICE_INTRO_MAX_SEC * 1000) {
      void finishRecording();
    }
  };

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert(
          'Microphone access needed',
          'To record a voice intro, allow microphone access for MiXiT in Settings. You can also skip this step.'
        );
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      voiceMsRef.current = 0;
      setRecordSeconds(0);
      setPendingVoiceUri(null);
      setWaveform(Array.from({ length: 24 }, () => 6));
      const { recording } = await Audio.Recording.createAsync(
        { ...Audio.RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true },
        onRecordingStatus,
        120
      );
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (error) {
      setIsRecording(false);
      Alert.alert('Recording failed', resolveErrorMessage(error));
    }
  };

  const startOrRedoRecording = () => {
    if (isRecording) {
      void finishRecording();
      return;
    }
    void startRecording();
  };

  const discardRecording = () => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (recording) recording.stopAndUnloadAsync().catch(() => undefined);
    setIsRecording(false);
    setPendingVoiceUri(null);
    setRecordSeconds(0);
  };

  const resetLocalState = () => {
    clearSession();
    void resetPurchasesUser();
    discardRecording();
    setSavedVoiceIntro(null);
    setAcceptedTerms(false);
    setStep(1);
    setOnboardingPhone('');
    setPhoneSaveError(null);
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
    setStepError(null);
    setShowCompletionStep(false);
    setIsEditingProfile(false);
    setLocationCoords(null);
    locationRequestedRef.current = false;
  };

  const handleLogout = () => {
    void logoutSession(refreshToken);
    resetLocalState();
  };

  // ---- Account deletion (App Store 5.1.1(v) / Google Play account deletion policy) ----
  const performAccountDeletion = async () => {
    setIsDeletingAccount(true);
    let appleAuthorizationCode: string | undefined;
    if (Platform.OS === 'ios' && isAppleSignInAvailable && sessionQuery.data?.user?.appleId) {
      // Apple requires revoking Sign in with Apple tokens on deletion; that needs a
      // fresh authorization code. If the user dismisses the prompt, still delete.
      try {
        const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
        appleAuthorizationCode = credential.authorizationCode ?? undefined;
      } catch {
        // cancelled — continue without revocation
      }
    }
    try {
      await deleteAccount(appleAuthorizationCode);
      resetLocalState();
      Alert.alert('Account deleted', 'Your MiXiT account and all its data have been permanently deleted.');
    } catch (error) {
      Alert.alert('Could not delete account', resolveErrorMessage(error));
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your profile, photos, voice intro, messages, vibes and purchase history. It can’t be undone.\n\nDeleting your account does not cancel an App Store or Google Play subscription — cancel it in your store settings to stop being charged.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => void performAccountDeletion() },
      ]
    );
  };

  useEffect(() => {
    return () => {
      recordingRef.current?.stopAndUnloadAsync().catch(() => undefined);
      if (sessionBannerTimerRef.current) clearTimeout(sessionBannerTimerRef.current);
    };
  }, []);

  const stepTitle = useMemo(() => {
    switch (step) {
      case 1:
        return 'Sign in';
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

  const voiceTimerSeconds = isRecording || pendingVoiceUri ? recordSeconds : savedVoiceIntro?.durationSec ?? 0;
  const voiceRecorder = (
    <>
      <Text style={styles.label}>
        {isRecording
          ? `Recording… keep going for at least ${VOICE_INTRO_MIN_SEC} seconds`
          : pendingVoiceUri
          ? 'New intro recorded — it will be saved with your profile'
          : savedVoiceIntro
          ? 'Your voice intro is saved'
          : `Record a ${VOICE_INTRO_MIN_SEC}-${VOICE_INTRO_MAX_SEC} second intro`}
      </Text>
      <Pressable
        style={styles.recordButton}
        onPress={startOrRedoRecording}
        accessibilityLabel={isRecording ? 'Stop recording' : hasVoiceClip ? 'Record again' : 'Start recording'}>
        <Text style={styles.recordButtonText}>{isRecording ? 'Stop' : hasVoiceClip ? 'Redo' : 'Mic'}</Text>
      </Pressable>
      <Text style={styles.timerText}>{`0:${String(voiceTimerSeconds).padStart(2, '0')}`}</Text>
      <View style={styles.waveWrap}>
        {waveform.map((h, i) => (
          <View
            key={`${i}-${h}`}
            style={[styles.waveBar, { height: h }, !isRecording && hasVoiceClip && styles.waveBarRecorded]}
          />
        ))}
      </View>
    </>
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
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
                  {user?.email ? <Text style={styles.profilePhone}>{user.email}</Text> : null}
                  {showPhone && user?.phone ? <Text style={styles.profilePhone}>{user.phone}</Text> : null}
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

            {profileCompleteness < 100 ? (
              <View style={styles.completenessCard}>
                <View style={styles.completenessHeader}>
                  <Text style={styles.completenessTitle}>Profile {profileCompleteness}% complete</Text>
                  <Text style={styles.completenessHint}>Complete profiles get 3× more vibes</Text>
                </View>
                <View style={styles.completenessBarBg}>
                  <View style={[styles.completenessBarFill, { width: `${profileCompleteness}%` as `${number}%` }]} />
                </View>
                <Text style={styles.completenessAction}>
                  {profileCompleteness < 40
                    ? 'Add a bio and city to get started'
                    : profileCompleteness < 70
                    ? 'Add photos and interests to stand out'
                    : 'Add a voice intro to unlock your full profile'}
                </Text>
              </View>
            ) : null}

            <Pressable style={styles.premiumCard} onPress={() => router.push('/premium')}>
              <Text style={styles.premiumCardTitle}>MiXiT Premium</Text>
              <Text style={styles.premiumCardBody}>Unlimited vibes, priority in Discover, and more.</Text>
            </Pressable>

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

                <Text style={styles.label}>City</Text>
                <TextInput
                  value={cityInput}
                  onChangeText={setCityInput}
                  placeholder="Your city"
                  placeholderTextColor="#8d90a6"
                  style={styles.input}
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

                <Text style={styles.label}>Phone Number</Text>
                <TextInput
                  value={onboardingPhone}
                  onChangeText={setOnboardingPhone}
                  placeholder="+27... — used for payments, shown on your profile"
                  placeholderTextColor="#8d90a6"
                  style={styles.input}
                  keyboardType="phone-pad"
                />
                {phoneSaveError ? <Text style={styles.errorText}>{phoneSaveError}</Text> : null}

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

                <Text style={styles.label}>Voice intro (optional)</Text>
                {voiceRecorder}

                <Pressable
                  style={[styles.button, (!canSaveProfile || saveProfileMutation.isPending || isRecording) && styles.buttonDisabled]}
                  disabled={!canSaveProfile || saveProfileMutation.isPending || isRecording}
                  onPress={() => {
                    savePhoneIfChanged();
                    saveProfileMutation.mutate(true);
                  }}>
                  <Text style={styles.buttonText}>
                    {saveProfileMutation.isPending ? 'Saving...' : 'Save profile'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.button, styles.secondaryButton]}
                  onPress={() => {
                    setIsEditingProfile(false);
                    setOnboardingPhone(user?.phone ?? '');
                    setPhoneSaveError(null);
                    const currentProfile = profileQuery.data;
                    if (currentProfile) {
                      setDisplayName(currentProfile.displayName ?? '');
                      setAge(currentProfile.age ?? 24);
                      setGender((currentProfile.gender as Gender) ?? 'female');
                      setBioInput(currentProfile.bio ?? '');
                      setCityInput(currentProfile.city ?? '');
                      setSelectedVibes(parseInterests(currentProfile));
                      setSelectedIntents(parseStringList(currentProfile.intents).slice(0, 4));
                      setTraitsText(parseStringList(currentProfile.traits).join('\n'));
                      setSelectedPhotos(parseStringList(currentProfile.photos).slice(0, 3));
                      setShowPhone(currentProfile.showPhone ?? true);
                      setShowLastSeen(currentProfile.showLastSeen ?? true);
                      setSavedVoiceIntro(
                        currentProfile.voiceIntroUrl && currentProfile.voiceIntroDurationSec
                          ? { url: currentProfile.voiceIntroUrl, durationSec: currentProfile.voiceIntroDurationSec }
                          : null
                      );
                    }
                    discardRecording();
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

            <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => router.push('/blocked')}>
              <Text style={styles.secondaryButtonText}>Blocked users</Text>
            </Pressable>

            <Pressable style={[styles.button, styles.secondaryButton]} onPress={handleLogout}>
              <Text style={styles.secondaryButtonText}>Log out</Text>
            </Pressable>

            <Pressable
              style={[styles.button, styles.dangerButton, isDeletingAccount && styles.buttonDisabled]}
              disabled={isDeletingAccount}
              onPress={handleDeleteAccount}>
              {isDeletingAccount ? (
                <ActivityIndicator color="#ff8a80" />
              ) : (
                <Text style={styles.dangerButtonText}>Delete account</Text>
              )}
            </Pressable>

            <View style={styles.legalLinksRow}>
              <Pressable onPress={() => openLegalPage('terms')}>
                <Text style={styles.legalLinkText}>Terms</Text>
              </Pressable>
              <Pressable onPress={() => openLegalPage('privacy')}>
                <Text style={styles.legalLinkText}>Privacy</Text>
              </Pressable>
              <Pressable onPress={() => openLegalPage('support')}>
                <Text style={styles.legalLinkText}>Help & support</Text>
              </Pressable>
            </View>
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
                <Text style={styles.label}>Sign in to MiXiT</Text>

                <Pressable
                  style={styles.termsRow}
                  onPress={() => setAcceptedTerms((prev) => !prev)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: acceptedTerms }}>
                  <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
                    {acceptedTerms ? <Text style={styles.checkboxTick}>✓</Text> : null}
                  </View>
                  <Text style={styles.termsText}>
                    I&apos;m 18 or older and I agree to the{' '}
                    <Text style={styles.termsLink} onPress={() => openLegalPage('terms')}>
                      Terms of Use
                    </Text>{' '}
                    and{' '}
                    <Text style={styles.termsLink} onPress={() => openLegalPage('privacy')}>
                      Privacy Policy
                    </Text>
                    . MiXiT has zero tolerance for abusive users or objectionable content.
                  </Text>
                </Pressable>

                {isAppleSignInAvailable ? (
                  <View style={[!acceptedTerms || isSigningIn ? styles.buttonDisabled : null]}>
                    <AppleAuthentication.AppleAuthenticationButton
                      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                      cornerRadius={14}
                      style={styles.appleButton}
                      onPress={() => {
                        if (!acceptedTerms || isSigningIn) return;
                        void handleAppleSignIn();
                      }}
                    />
                  </View>
                ) : null}

                {isGoogleSignInConfigured ? (
                  <Pressable
                    style={[styles.button, (isSigningIn || !acceptedTerms) && styles.buttonDisabled]}
                    disabled={isSigningIn || !acceptedTerms}
                    onPress={handleGoogleSignIn}>
                    <Text style={styles.buttonText}>
                      {isSigningIn ? 'Signing in...' : 'Continue with Google'}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={styles.supportText}>
                    Google Sign-In is not configured yet. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID to enable it.
                  </Text>
                )}

                {/* Demo-account sign-in for App Store / Google Play reviewers. */}
                {showReviewLogin ? (
                  <View style={styles.reviewBlock}>
                    <TextInput
                      value={reviewEmail}
                      onChangeText={setReviewEmail}
                      placeholder="Email"
                      placeholderTextColor="#8d90a6"
                      style={styles.input}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                      textContentType="username"
                    />
                    <TextInput
                      value={reviewPassword}
                      onChangeText={setReviewPassword}
                      placeholder="Password"
                      placeholderTextColor="#8d90a6"
                      style={styles.input}
                      secureTextEntry
                      textContentType="password"
                    />
                    <Pressable
                      style={[
                        styles.button,
                        styles.secondaryButton,
                        (isSigningIn || !acceptedTerms || !reviewEmail.trim() || !reviewPassword) && styles.buttonDisabled,
                      ]}
                      disabled={isSigningIn || !acceptedTerms || !reviewEmail.trim() || !reviewPassword}
                      onPress={() => reviewAuthMutation.mutate()}>
                      <Text style={styles.secondaryButtonText}>Sign in</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => setShowReviewLogin(true)} style={styles.reviewLink}>
                    <Text style={styles.legalLinkText}>App reviewer? Sign in with email</Text>
                  </Pressable>
                )}
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

                <Text style={styles.label}>Phone (optional)</Text>
                <TextInput
                  value={onboardingPhone}
                  onChangeText={setOnboardingPhone}
                  placeholder="+27... — used for payments, shown on your profile"
                  placeholderTextColor="#8d90a6"
                  style={styles.input}
                  keyboardType="phone-pad"
                />
                {phoneSaveError ? <Text style={styles.errorText}>{phoneSaveError}</Text> : null}

                <Pressable
                  style={[styles.button, !canProceedStep3 && styles.buttonDisabled]}
                  disabled={!canProceedStep3}
                  onPress={() => {
                    savePhoneIfChanged();
                    setStep(4);
                  }}>
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

                <Text style={styles.label}>Photos (optional — add up to 3)</Text>
                <View style={styles.mediaRow}>
                  {[0, 1, 2].map((index) => {
                    const uri = selectedPhotos[index] ?? null;
                    return (
                      <View key={`setup-photo-${index}`} style={styles.mediaEditorCell}>
                        <Pressable
                          style={styles.mediaTile}
                          onPress={() => pickPhotoAt(index)}
                          disabled={uploadingPhotoIndex !== null}>
                          {uploadingPhotoIndex === index ? (
                            <ActivityIndicator color="#ff6b35" />
                          ) : uri ? (
                            <Image source={{ uri }} style={styles.mediaImage} contentFit="cover" />
                          ) : (
                            <Text style={styles.mediaPlaceholder}>+</Text>
                          )}
                        </Pressable>
                        {uri && uploadingPhotoIndex !== index ? (
                          <Pressable style={styles.mediaAction} onPress={() => removePhotoAt(index)}>
                            <Text style={styles.mediaActionText}>Remove</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                </View>

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
                {voiceRecorder}
                <Pressable
                  style={[styles.button, (!hasVoiceClip || saveProfileMutation.isPending) && styles.buttonDisabled]}
                  disabled={!hasVoiceClip || saveProfileMutation.isPending}
                  onPress={() => saveProfileMutation.mutate(false)}>
                  <Text style={styles.buttonText}>
                    {saveProfileMutation.isPending ? 'Finishing...' : 'Finish setup'}
                  </Text>
                </Pressable>
                {/* Voice intro is optional — never block onboarding on microphone access. */}
                {!pendingVoiceUri ? (
                  <Pressable
                    style={[styles.button, styles.secondaryButton, (saveProfileMutation.isPending || isRecording) && styles.buttonDisabled]}
                    disabled={saveProfileMutation.isPending || isRecording}
                    onPress={() => saveProfileMutation.mutate(false)}>
                    <Text style={styles.secondaryButtonText}>Skip for now</Text>
                  </Pressable>
                ) : null}
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
                    // Ask for notifications now that there's something to be notified about.
                    void registerForPushNotifications({ prompt: true });
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
  completenessCard: {
    backgroundColor: 'rgba(255,107,53,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.3)',
    borderRadius: 16,
    padding: 14,
    gap: 8,
    marginBottom: 4,
  },
  premiumCard: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 16,
    padding: 14,
    gap: 4,
    marginTop: 12,
    marginBottom: 4,
  },
  premiumCardTitle: {
    color: '#ffb08f',
    fontWeight: '700',
    fontSize: 16,
  },
  premiumCardBody: {
    color: '#c6cbe2',
    fontSize: 13,
  },
  completenessHeader: {
    gap: 2,
  },
  completenessTitle: {
    color: '#f4f6ff',
    fontWeight: '700',
    fontSize: 15,
  },
  completenessHint: {
    color: '#ff9f72',
    fontSize: 13,
  },
  completenessBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  completenessBarFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ff6b35',
  },
  completenessAction: {
    color: '#c8cfe9',
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
  dangerButton: {
    backgroundColor: 'rgba(255,59,48,0.10)',
    borderColor: 'rgba(255,107,96,0.45)',
    marginTop: 20,
  },
  dangerButtonText: {
    color: '#ff8a80',
    fontWeight: '700',
    fontSize: 16,
  },
  legalLinksRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
    marginTop: 18,
    marginBottom: 8,
  },
  legalLinkText: {
    color: '#9aa1c0',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 6,
    marginBottom: 6,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: '#ff6b35',
    borderColor: '#ff6b35',
  },
  checkboxTick: {
    color: '#111524',
    fontWeight: '800',
    fontSize: 14,
  },
  termsText: {
    flex: 1,
    color: '#c6cbe2',
    fontSize: 13,
    lineHeight: 19,
  },
  termsLink: {
    color: '#ffb08f',
    textDecorationLine: 'underline',
  },
  appleButton: {
    height: 48,
    marginTop: 12,
  },
  reviewBlock: {
    marginTop: 16,
    gap: 8,
  },
  reviewLink: {
    alignSelf: 'center',
    marginTop: 18,
    paddingVertical: 6,
  },
});
