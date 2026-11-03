// Dynamic config (not app.json) because the Google Sign-In config plugin needs an
// `iosUrlScheme` computed from the iOS OAuth client ID at build time. Without this,
// the plugin falls back to a mode that requires Firebase config files
// (google-services.json / GoogleService-Info.plist) — this stack has no Firebase
// project anywhere (it's Supabase-based), so that path isn't viable.
function iosUrlSchemeFromClientId(clientId) {
  // Google iOS OAuth client IDs look like "1234567890-abc123.apps.googleusercontent.com".
  // The associated URL scheme is that same value with the suffix swapped for a
  // "com.googleusercontent.apps." prefix — Google issues both together.
  const suffix = '.apps.googleusercontent.com';
  if (!clientId || !clientId.endsWith(suffix)) return null;
  return `com.googleusercontent.apps.${clientId.slice(0, -suffix.length)}`;
}

const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
const googleIosUrlScheme =
  iosUrlSchemeFromClientId(googleIosClientId) ??
  // Keeps `expo prebuild`/`eas build` from hard-failing before Google Sign-In is
  // configured, matching this app's "degrade gracefully until configured" pattern
  // used elsewhere (PayFast, Supabase, Sentry). Google Sign-In itself won't work
  // until EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is set to a real client ID.
  'com.googleusercontent.apps.000000000000-placeholder';

module.exports = {
  expo: {
    name: 'MiXiT',
    slug: 'MiXiT',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'mixit',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      // iPhone-only: the layouts aren't designed for iPad, and supporting it makes
      // App Review test on iPad and requires iPad screenshots.
      supportsTablet: false,
      bundleIdentifier: 'com.mixit.app',
      usesAppleSignIn: true,
      config: {
        usesNonExemptEncryption: false,
      },
      infoPlist: {
        NSMicrophoneUsageDescription: 'Allow MiXiT to use your microphone to record your profile voice intro and voice notes in chats.',
      },
      // App-level privacy manifest (required-reason APIs used by React Native,
      // AsyncStorage and Expo modules). Third-party SDK manifests are merged in at build.
      privacyManifests: {
        NSPrivacyTracking: false,
        NSPrivacyAccessedAPITypes: [
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1', '0A2A.1', '3B52.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1', '85F4.1'] },
        ],
      },
    },
    android: {
      package: 'com.mixit.app',
      versionCode: 1,
      adaptiveIcon: {
        backgroundColor: '#060710',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      permissions: ['android.permission.RECORD_AUDIO'],
      // The app uses the system photo picker (no storage/media permission needed)
      // and never the camera. Declaring these would trigger Google Play's
      // Photo & Video Permissions policy review for no benefit.
      blockedPermissions: [
        'android.permission.CAMERA',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
      ],
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-notifications',
        {
          icon: './assets/images/notification-icon.png',
          color: '#ff6b35',
          sounds: [],
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: 'Allow MiXiT to access your photos so you can add them to your profile or send them in chats.',
          // Camera is never used; `false` keeps the plugin from adding the
          // camera / microphone permissions (and from overriding the mic string above).
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission: 'Allow MiXiT to use your location to show accurate distance to people nearby.',
        },
      ],
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-icon.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#060710',
          dark: {
            backgroundColor: '#060710',
          },
        },
      ],
      '@sentry/react-native',
      'expo-apple-authentication',
      [
        '@react-native-google-signin/google-signin',
        {
          iosUrlScheme: googleIosUrlScheme,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: '8d5afaed-69a1-4b2d-a670-3eca6208baaa',
      },
    },
  },
};
