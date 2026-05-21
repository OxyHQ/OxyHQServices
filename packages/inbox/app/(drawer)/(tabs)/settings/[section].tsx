/**
 * Settings section route — /settings/:section
 *
 * Renders a specific settings section (general, signature, vacation, appearance).
 */

import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';

import { SettingsPage } from '@/components/SettingsPage';

export default function SettingsSectionScreen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const sectionLabel = section
    ? section.charAt(0).toUpperCase() + section.slice(1)
    : 'Settings';
  return (
    <>
      <Head>
        <title>{`${sectionLabel} · Settings · Oxy`}</title>
      </Head>
      <SettingsPage section={section} />
    </>
  );
}
