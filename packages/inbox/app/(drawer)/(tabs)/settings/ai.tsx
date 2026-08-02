/**
 * /settings/ai — AI feature toggles (Brief, Smart Reply, Categorization).
 *
 * Authentication is guaranteed by the app-wide `RequireOxyAuth prompt="hard"`
 * gate in `app/_layout.tsx`, so this screen renders its section directly.
 */

import React from 'react';
import Head from 'expo-router/head';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { AISection } from '@/components/settings/sections/AISection';

export default function AIScreen() {
  return (
    <>
      <Head>
        <title>AI · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="AI features">
        <AISection />
      </SettingsScreenShell>
    </>
  );
}
