/**
 * /settings/ai — AI feature toggles (Brief, Smart Reply, Categorization).
 * Requires authentication; otherwise renders the standard `SettingsAuthGate`.
 */

import React from 'react';
import Head from 'expo-router/head';
import { useOxy } from '@oxyhq/services';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { SettingsAuthGate } from '@/components/settings/SettingsAuthGate';
import { AISection } from '@/components/settings/sections/AISection';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionDef,
} from '@/components/settings/sections-catalog';

function findSection(key: SettingsSectionDef['key']): SettingsSectionDef {
  const match = SETTINGS_SECTIONS.find((s) => s.key === key);
  if (!match) throw new Error(`Unknown settings section: ${key}`);
  return match;
}

export default function AIScreen() {
  const { isAuthenticated } = useOxy();
  const section = findSection('ai');

  return (
    <>
      <Head>
        <title>AI · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="AI features">
        {isAuthenticated ? (
          <AISection />
        ) : (
          <SettingsAuthGate sectionLabel={section.label} icon={section.icon} />
        )}
      </SettingsScreenShell>
    </>
  );
}
