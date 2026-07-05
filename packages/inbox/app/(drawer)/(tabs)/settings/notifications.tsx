/**
 * /settings/notifications — push, digest, and sound preferences.
 *
 * Authentication is guaranteed by the app-wide `RequireOxyAuth prompt="hard"`
 * gate in `app/_layout.tsx`, so this screen renders its section directly.
 */

import React from 'react';
import Head from 'expo-router/head';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { NotificationsSection } from '@/components/settings/sections/NotificationsSection';

export default function NotificationsScreen() {
  return (
    <>
      <Head>
        <title>Notifications · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="Notifications">
        <NotificationsSection />
      </SettingsScreenShell>
    </>
  );
}
