/**
 * Settings section route — /settings/:section
 *
 * Renders a specific settings section (general, signature, vacation, appearance).
 */

import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { SettingsPage } from '@/components/SettingsPage';

export default function SettingsSectionScreen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  return <SettingsPage section={section} />;
}
