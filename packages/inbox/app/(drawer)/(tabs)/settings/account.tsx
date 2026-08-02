/**
 * /settings/account — profile, signature, vacation, forwarding, sign out.
 *
 * Authentication is guaranteed by the app-wide `RequireOxyAuth prompt="hard"`
 * gate in `app/_layout.tsx`, so this screen renders its section directly.
 *
 * The Save affordance is rendered inline at the bottom of the form (only
 * when the draft is dirty) — see `AccountSection`. This avoids lifting
 * mutation state up to the screen header and keeps the section
 * self-contained.
 */

import React from 'react';
import Head from 'expo-router/head';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { AccountSection } from '@/components/settings/sections/AccountSection';

export default function AccountScreen() {
  return (
    <>
      <Head>
        <title>Account · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="Account">
        <AccountSection />
      </SettingsScreenShell>
    </>
  );
}
