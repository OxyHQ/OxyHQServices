/**
 * /settings/privacy — tracking protection and sender trust defaults.
 *
 * Authentication is guaranteed by the app-wide `RequireOxyAuth prompt="hard"`
 * gate in `app/_layout.tsx`, so this screen renders its section directly.
 */

import React from 'react';
import Head from 'expo-router/head';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { PrivacySection } from '@/components/settings/sections/PrivacySection';

export default function PrivacyScreen() {
  return (
    <>
      <Head>
        <title>Privacy · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="Privacy">
        <PrivacySection />
      </SettingsScreenShell>
    </>
  );
}
