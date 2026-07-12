const { oxySplashScreenPlugin } = require('@oxyhq/expo-splash/config');

// App variant — lets a development build sit next to the production app on the
// SAME device by giving it a distinct applicationId/bundleId + name.
// Build the dev variant with `APP_VARIANT=development` (e.g.
// `APP_VARIANT=development npx expo run:android`); production is the default.
// The URL scheme is intentionally shared, so the NFC/deep-link plumbing
// (`plugins/with-hce.js`, the `oxycommons://` payloads in @oxyhq/core) keeps
// working unchanged — Android just shows an app chooser when both are installed.
const IS_DEV_VARIANT = process.env.APP_VARIANT === 'development';
const APP_ID = IS_DEV_VARIANT ? 'so.oxy.commons.dev' : 'so.oxy.commons';
const APP_NAME = IS_DEV_VARIANT ? 'Commons (Dev)' : 'Commons by Oxy';

module.exports = {
  expo: {
    name: APP_NAME,
    slug: 'commons',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: ['commons', 'oxycommons'],
    userInterfaceStyle: 'automatic',
    platforms: ['ios', 'android'],
    android: {
      adaptiveIcon: {
        backgroundColor: '#000000',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: true,
      softwareKeyboardLayoutMode: 'resize',
      permissions: [
        'android.permission.USE_BIOMETRIC',
        'android.permission.USE_FINGERPRINT',
      ],
      package: APP_ID,
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: APP_ID,
    },
    plugins: [
      'expo-router',
      // Native OS splash (Oxy family "Instagram, from Meta" pattern): Commons'
      // own logo (the Oxy mark as a white silhouette on transparent) centered on
      // the dark brand background, with the shared Oxy symbol pinned to the
      // bottom. `oxySplashScreenPlugin` builds the expo-splash-screen tuple; the
      // bare `@oxyhq/expo-splash` entry (bundled Oxy asset) MUST immediately
      // follow it to add the bottom branding.
      oxySplashScreenPlugin({
        image: './assets/images/splash-logo.png',
        imageWidth: 176,
        backgroundColor: '#0B0B0F',
      }),
      '@oxyhq/expo-splash',
      [
        'expo-local-authentication',
        {
          faceIDPermission:
            'Allow $(PRODUCT_NAME) to use Face ID to protect your identity.',
        },
      ],
      [
        'expo-build-properties',
        {
          android: {
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            useLegacyPackaging: true,
          },
        },
      ],
      [
        'expo-camera',
        {
          cameraPermission: 'Allow $(PRODUCT_NAME) to scan sign-in QR codes.',
        },
      ],
      [
        'react-native-nfc-manager',
        {
          nfcPermission: 'Allow $(PRODUCT_NAME) to read attestation cards from nearby phones.',
        },
      ],
      './plugins/with-hce',
      'expo-secure-store',
      'expo-font',
      'expo-image',
      'expo-sharing',
      'expo-status-bar',
      'expo-web-browser',
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
      eas: {
        projectId: '',
      },
    },
    owner: 'oxyhq',
  },
};
