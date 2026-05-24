/**
 * /settings/inbox-prefs — display, reading, and swipe preferences.
 * Always accessible — these are local device preferences.
 */

import React from 'react';
import Head from 'expo-router/head';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { InboxPrefsSection } from '@/components/settings/sections/InboxPrefsSection';

export default function InboxPrefsScreen() {
  return (
    <>
      <Head>
        <title>Inbox · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="Inbox" subtitle="Display, reading, and swipe actions">
        <InboxPrefsSection />
      </SettingsScreenShell>
    </>
  );
}
