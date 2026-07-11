const { oxySplashScreenPlugin } = require('@oxyhq/expo-splash/config');

module.exports = {
  expo: {
    name: 'Commons by Oxy',
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
      package: 'so.oxy.commons',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'so.oxy.commons',
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
