/**
 * /settings/account — profile, signature, vacation, forwarding, sign out.
 * Requires authentication; otherwise renders the standard `SettingsAuthGate`.
 *
 * The Save affordance is rendered inline at the bottom of the form (only
 * when the draft is dirty) — see `AccountSection`. This avoids lifting
 * mutation state up to the screen header and keeps the section
 * self-contained.
 */

import React from 'react';
import Head from 'expo-router/head';
import { useOxy } from '@oxyhq/services';

import { SettingsScreenShell } from '@/components/settings/SettingsScreenShell';
import { SettingsAuthGate } from '@/components/settings/SettingsAuthGate';
import { AccountSection } from '@/components/settings/sections/AccountSection';
import {
  SETTINGS_SECTIONS,
  type SettingsSectionDef,
} from '@/components/settings/sections-catalog';

function findSection(key: SettingsSectionDef['key']): SettingsSectionDef {
  const match = SETTINGS_SECTIONS.find((s) => s.key === key);
  if (!match) throw new Error(`Unknown settings section: ${key}`);
  return match;
}

export default function AccountScreen() {
  const { isAuthenticated } = useOxy();
  const section = findSection('account');

  return (
    <>
      <Head>
        <title>Account · Settings · Inbox · Oxy</title>
      </Head>
      <SettingsScreenShell title="Account">
        {isAuthenticated ? (
          <AccountSection />
        ) : (
          <SettingsAuthGate sectionLabel={section.label} icon={section.icon} />
        )}
      </SettingsScreenShell>
    </>
  );
}
