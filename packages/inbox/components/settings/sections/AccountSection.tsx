/**
 * Account subscreen — identity, signature, vacation, forwarding, sign out.
 *
 * Layout follows the Alia settings pattern: a `View` with generous `gap`
 * spacing, each subsection introduced by a small icon + uppercase eyebrow
 * label. No row-spam — the controls are visual blocks the user reads top
 * to bottom.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Avatar } from '@oxyhq/bloom/avatar';
import { Button } from '@oxyhq/bloom/button';
import { Switch } from '@oxyhq/bloom/switch';
import { GroupedButtons } from '@oxyhq/bloom/grouped-buttons';
import { Text } from '@oxyhq/bloom/typography';
import { useTheme } from '@oxyhq/bloom/theme';
import * as Prompt from '@oxyhq/bloom/prompt';
import { usePromptControl } from '@oxyhq/bloom/prompt';
import {
  Pencil_Stroke2_Corner0_Rounded,
  ArrowBoxLeft_Stroke2_Corner0_Rounded,
  ArrowOutOfBox_Stroke2_Corner0_Rounded,
  PaperPlane_Stroke2_Corner0_Rounded,
} from '@oxyhq/bloom/icons';
import { useOxy, toast } from '@oxyhq/services';

import { useColors } from '@/constants/theme';
import { useSettings, useUpdateSettings } from '@/hooks/queries/useSettings';
import type { EmailSettings } from '@/services/emailApi';
import { SectionHeader } from '@/components/settings/SectionHeader';

type SettingsDraft = {
  signature: string;
  autoReplyEnabled: boolean;
  autoReplySubject: string;
  autoReplyBody: string;
  autoForwardTo: string;
  autoForwardKeepCopy: boolean;
};

function toDraft(data: EmailSettings | undefined): SettingsDraft {
  return {
    signature: data?.signature ?? '',
    autoReplyEnabled: data?.autoReply.enabled ?? false,
    autoReplySubject: data?.autoReply.subject ?? '',
    autoReplyBody: data?.autoReply.body ?? '',
    autoForwardTo: data?.autoForwardTo ?? '',
    autoForwardKeepCopy: data?.autoForwardKeepCopy ?? true,
  };
}

function draftsEqual(a: SettingsDraft, b: SettingsDraft): boolean {
  return (
    a.signature === b.signature &&
    a.autoReplyEnabled === b.autoReplyEnabled &&
    a.autoReplySubject === b.autoReplySubject &&
    a.autoReplyBody === b.autoReplyBody &&
    a.autoForwardTo === b.autoForwardTo &&
    a.autoForwardKeepCopy === b.autoForwardKeepCopy
  );
}

/** React-docs derived-state pattern: re-sync the draft only when the server
 *  snapshot changes AND the user has no pending edits. No useEffect. */
function useDirtySettings(settingsData: EmailSettings | undefined) {
  const [serverSnapshot, setServerSnapshot] = useState<EmailSettings | undefined>(settingsData);
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(settingsData));

  if (settingsData !== serverSnapshot) {
    const isClean = draftsEqual(draft, toDraft(serverSnapshot));
    setServerSnapshot(settingsData);
    if (isClean) {
      setDraft(toDraft(settingsData));
    }
  }

  const dirty = !draftsEqual(draft, toDraft(settingsData));

  const setField = useCallback(
    <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => {
      setDraft((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  return { draft, setField, dirty };
}

export function AccountSection() {
  const colors = useColors();
  const theme = useTheme();
  const { user, oxyServices, logout } = useOxy();
  const { data: settingsData } = useSettings();
  const updateSettings = useUpdateSettings();

  const { draft, setField, dirty } = useDirtySettings(settingsData);
  const {
    signature,
    autoReplyEnabled,
    autoReplySubject,
    autoReplyBody,
    autoForwardTo,
    autoForwardKeepCopy,
  } = draft;

  const saving = updateSettings.isPending;

  const handleSave = useCallback(() => {
    updateSettings.mutate(
      {
        signature,
        autoReply: {
          enabled: autoReplyEnabled,
          subject: autoReplySubject,
          body: autoReplyBody,
        },
        autoForwardTo,
        autoForwardKeepCopy,
      },
      {
        onSuccess: () => toast.success('Settings updated.'),
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : 'Failed to save settings.';
          toast.error(message);
        },
      },
    );
  }, [
    signature,
    autoReplyEnabled,
    autoReplySubject,
    autoReplyBody,
    autoForwardTo,
    autoForwardKeepCopy,
    updateSettings,
  ]);

  const signOutPrompt = usePromptControl();

  const fullName = useMemo(() => {
    return (
      user?.name?.full?.trim()
      || [user?.name?.first, user?.name?.last].filter(Boolean).join(' ').trim()
      || user?.username
      || 'Account'
    );
  }, [user]);

  const emailAddress = user?.email || (user ? `${user.username}@oxy.so` : '');
  const avatarUri = user?.avatar ? oxyServices.getFileDownloadUrl(user.avatar, 'thumb') : undefined;

  const handleSignOut = useCallback(async () => {
    try {
      await logout();
      toast.success('Signed out.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sign out.';
      toast.error(message);
    }
  }, [logout]);

  const inputStyle = {
    color: colors.text,
    backgroundColor: theme.colors.background,
    borderColor: colors.border,
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      {/* Profile hero */}
      <View style={styles.hero}>
        <Avatar uri={avatarUri} name={fullName} size={64} />
        <View style={styles.heroText}>
          <Text style={[styles.heroName, { color: colors.text }]} numberOfLines={1}>
            {fullName}
          </Text>
          {!!emailAddress && (
            <Text style={[styles.heroEmail, { color: colors.secondaryText }]} numberOfLines={1}>
              {emailAddress}
            </Text>
          )}
        </View>
      </View>

      {/* Signature */}
      <View style={styles.subsection}>
        <SectionHeader icon={Pencil_Stroke2_Corner0_Rounded} title="Signature" />
        <TextInput
          value={signature}
          onChangeText={(v) => setField('signature', v)}
          placeholder="Appended to every outgoing message"
          placeholderTextColor={colors.secondaryText}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          style={[styles.textArea, inputStyle]}
        />
      </View>

      {/* Vacation auto-reply */}
      <View style={styles.subsection}>
        <SectionHeader icon={PaperPlane_Stroke2_Corner0_Rounded} title="Auto-reply" />
        <Pressable
          onPress={() => setField('autoReplyEnabled', !autoReplyEnabled)}
          accessibilityRole="switch"
          accessibilityState={{ checked: autoReplyEnabled }}
          style={styles.inlineSwitch}
        >
          <View style={styles.inlineSwitchText}>
            <Text style={[styles.inlineSwitchTitle, { color: colors.text }]}>
              Vacation responder
            </Text>
            <Text style={[styles.inlineSwitchSub, { color: colors.secondaryText }]}>
              {autoReplyEnabled
                ? 'Replies are sent automatically.'
                : 'Off — incoming mail flows normally.'}
            </Text>
          </View>
          <Switch
            value={autoReplyEnabled}
            onValueChange={(v) => setField('autoReplyEnabled', v)}
          />
        </Pressable>

        {autoReplyEnabled ? (
          <View style={styles.indentedBlock}>
            <TextInput
              value={autoReplySubject}
              onChangeText={(v) => setField('autoReplySubject', v)}
              placeholder="Subject"
              placeholderTextColor={colors.secondaryText}
              style={[styles.input, inputStyle]}
            />
            <TextInput
              value={autoReplyBody}
              onChangeText={(v) => setField('autoReplyBody', v)}
              placeholder="Message — explain when you'll be back."
              placeholderTextColor={colors.secondaryText}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              style={[styles.textArea, inputStyle]}
            />
          </View>
        ) : null}
      </View>

      {/* Forwarding */}
      <View style={styles.subsection}>
        <SectionHeader icon={ArrowOutOfBox_Stroke2_Corner0_Rounded} title="Forwarding" />
        <TextInput
          value={autoForwardTo}
          onChangeText={(v) => setField('autoForwardTo', v)}
          placeholder="Forward incoming mail to address"
          placeholderTextColor={colors.secondaryText}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, inputStyle]}
        />
        {autoForwardTo.trim().length > 0 ? (
          <Pressable
            onPress={() => setField('autoForwardKeepCopy', !autoForwardKeepCopy)}
            accessibilityRole="switch"
            accessibilityState={{ checked: autoForwardKeepCopy }}
            style={styles.inlineSwitch}
          >
            <View style={styles.inlineSwitchText}>
              <Text style={[styles.inlineSwitchTitle, { color: colors.text }]}>
                Keep a copy in Inbox
              </Text>
              <Text style={[styles.inlineSwitchSub, { color: colors.secondaryText }]}>
                Recommended so you retain a record of forwarded mail.
              </Text>
            </View>
            <Switch
              value={autoForwardKeepCopy}
              onValueChange={(v) => setField('autoForwardKeepCopy', v)}
            />
          </Pressable>
        ) : null}
      </View>

      {/* Save bar */}
      {dirty ? (
        <View style={styles.saveBar}>
          <Button onPress={handleSave} disabled={saving} style={styles.saveButton}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </View>
      ) : null}

      {/* Danger zone */}
      <View style={styles.subsection}>
        <SectionHeader icon={ArrowBoxLeft_Stroke2_Corner0_Rounded} title="Account actions" />
        <GroupedButtons>
          <GroupedButtons.Item
            label="Sign out"
            description="You'll be signed out of this device only."
            onPress={() => signOutPrompt.open()}
          />
        </GroupedButtons>
      </View>

      <Prompt.Basic
        control={signOutPrompt}
        title="Sign out?"
        description="You can sign back in at any time."
        confirmButtonCta="Sign out"
        cancelButtonCta="Cancel"
        confirmButtonColor="negative"
        onConfirm={handleSignOut}
      />

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 24,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingBottom: 4,
  },
  heroText: {
    flex: 1,
    gap: 2,
  },
  heroName: {
    fontSize: 18,
    fontWeight: '600',
  },
  heroEmail: {
    fontSize: 14,
  },
  subsection: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 96,
  },
  inlineSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  inlineSwitchText: {
    flex: 1,
    gap: 2,
  },
  inlineSwitchTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  inlineSwitchSub: {
    fontSize: 13,
    lineHeight: 17,
  },
  indentedBlock: {
    gap: 10,
  },
  saveBar: {
    paddingTop: 4,
  },
  saveButton: {
    width: '100%',
  },
});
