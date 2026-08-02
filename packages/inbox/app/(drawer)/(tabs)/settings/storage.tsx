/**
 * /settings/storage — quota usage and local cache management.
 *
 * Authentication is guaranteed by the app-wide `RequireOxyAuth prompt="hard"`
 * gate in `app/_layout.tsx`, so this screen renders its section directly.
 */

import React from 'react';
import Head from 'expo-router/head';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { StorageSection } from '@/components/settings/sections/StorageSection';

export default function StorageScreen() {
  return (
    <>
      <Head>
        <title>Storage · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="Storage">
        <StorageSection />
      </SettingsScreenShell>
    </>
  );
}
