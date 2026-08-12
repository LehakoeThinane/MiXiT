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
      supportsTablet: true,
      bundleIdentifier: 'com.mixit.app',
      infoPlist: {
        NSMicrophoneUsageDescription: 'Allow MiXiT to access your microphone for voice introductions.',
      },
    },
    android: {
      package: 'com.mixit.app',
      versionCode: 1,
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      permissions: ['android.permission.RECORD_AUDIO'],
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
          icon: './assets/images/icon.png',
          color: '#ff6b35',
          sounds: [],
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: 'Allow MiXiT to access your photos so you can update your profile.',
          cameraPermission: 'Allow MiXiT to access your camera so you can take profile photos.',
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
          backgroundColor: '#ffffff',
          dark: {
            backgroundColor: '#000000',
          },
        },
      ],
      '@sentry/react-native',
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
