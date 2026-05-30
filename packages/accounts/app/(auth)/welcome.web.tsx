import React from 'react';
import { Redirect } from 'expo-router';

/**
 * Welcome Screen (Web)
 *
 * The native welcome screen is the terms/intro gate that leads into identity
 * CREATION. Since creation is native-only, web must never render it — a web
 * visitor who lands on `/welcome` (history, deep link) is redirected to the
 * sign-in screen instead.
 */
export default function WelcomeWebScreen() {
  return <Redirect href="/(auth)/sign-in" />;
}
