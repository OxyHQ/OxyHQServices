/**
 * /settings/about — version, credits, and legal links. Always accessible.
 */

import React from 'react';
import Head from 'expo-router/head';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { AboutSection } from '@/components/settings/sections/AboutSection';

export default function AboutScreen() {
  return (
    <>
      <Head>
        <title>About · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="About">
        <AboutSection />
      </SettingsScreenShell>
    </>
  );
}
