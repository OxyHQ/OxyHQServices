const { oxySplashScreenPlugin } = require('@oxyhq/expo-splash/config');

module.exports = {
  expo: {
    name: 'Accounts by Oxy',
    slug: 'Oxy',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'accounts',
    userInterfaceStyle: 'automatic',
    android: {
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: true,
      softwareKeyboardLayoutMode: 'pan',
      permissions: [
        'android.permission.USE_BIOMETRIC',
        'android.permission.USE_FINGERPRINT',
      ],
      package: 'so.oxy.accounts',
    },
    ios: {
      supportsTablet: true,
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      // Native OS splash (Oxy family "Instagram, from Meta" pattern): Accounts'
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
        projectId: 'b1dd5391-7c83-492a-9312-15ea2a999ddd',
      },
    },
    owner: 'oxyhq',
  },
};
