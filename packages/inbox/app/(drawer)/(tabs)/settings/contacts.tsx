/**
 * /settings/contacts — manage saved contacts.
 *
 * Authentication is guaranteed by the app-wide `RequireOxyAuth prompt="hard"`
 * gate in `app/_layout.tsx`, so this screen renders its section directly.
 */

import React from 'react';
import Head from 'expo-router/head';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { ContactsSection } from '@/components/settings/sections/ContactsSection';

export default function ContactsScreen() {
  return (
    <>
      <Head>
        <title>Contacts · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="Contacts" subtitle="People you email">
        <ContactsSection />
      </SettingsScreenShell>
    </>
  );
}
