/**
 * /settings/labels — manage custom labels.
 *
 * Authentication is guaranteed by the app-wide `RequireOxyAuth prompt="hard"`
 * gate in `app/_layout.tsx`, so this screen renders its section directly.
 */

import React from 'react';
import Head from 'expo-router/head';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { LabelsSection } from '@/components/settings/sections/LabelsSection';

export default function LabelsScreen() {
  return (
    <>
      <Head>
        <title>Labels · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="Labels">
        <LabelsSection />
      </SettingsScreenShell>
    </>
  );
}
