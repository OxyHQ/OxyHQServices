/**
 * Settings index route.
 *
 * Desktop: rendered in Slot — shows General section by default.
 * Mobile: renders the full settings page with all sections.
 */

import React from 'react';
import { Platform, useWindowDimensions } from 'react-native';

import { SettingsPage } from '@/components/SettingsPage';

export default function SettingsIndex() {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 900;

  // On desktop, show general section in the content pane
  // On mobile, show the full settings page
  return <SettingsPage section={isDesktop ? 'general' : undefined} />;
}
