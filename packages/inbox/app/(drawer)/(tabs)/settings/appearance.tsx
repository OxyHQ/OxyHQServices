/**
 * /settings/appearance — theme mode + accent color.
 *
 * Always accessible (no auth gate) since these preferences are local and
 * shape the inbox even before the user signs in.
 */

import React from 'react';
import Head from 'expo-router/head';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { AppearanceSection } from '@/components/settings/sections/AppearanceSection';

export default function AppearanceScreen() {
  return (
    <>
      <Head>
        <title>Appearance · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="Appearance">
        <AppearanceSection />
      </SettingsScreenShell>
    </>
  );
}
