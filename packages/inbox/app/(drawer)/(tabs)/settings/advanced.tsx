/**
 * /settings/advanced — filters, templates, and import.
 *
 * Always accessible — the surface is light enough on the public side
 * (templates/filters list and import are no-ops without an account) to
 * not warrant a hard gate. The authenticated-only mutations short-circuit
 * gracefully when no API is configured.
 */

import React from 'react';
import Head from 'expo-router/head';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { AdvancedSection } from '@/components/settings/sections/AdvancedSection';

export default function AdvancedScreen() {
  return (
    <>
      <Head>
        <title>Advanced · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="Advanced" subtitle="Filters, templates, import">
        <AdvancedSection />
      </SettingsScreenShell>
    </>
  );
}
