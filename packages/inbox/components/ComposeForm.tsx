/**
 * Reusable compose / reply / forward form.
 *
 * Supports two modes:
 * - standalone: full-screen route with close/back button (mobile)
 * - embedded: inline panel without safe area padding (desktop split-view)
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Cancel01Icon,
  FloppyDiskIcon,
  MailSend01Icon,
  ArrowDown01Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy, toast } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useSendMessage, useSaveDraft } from '@/hooks/mutations/useMessageMutations';

interface ComposeFormProps {
  mode: 'standalone' | 'embedded';
  replyTo?: string;
  forward?: string;
  to?: string;
  subject?: string;
  body?: string;
}

export function ComposeForm({ mode, replyTo, forward, to: initialTo, subject: initialSubject, body: initialBody }: ComposeFormProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const { user } = useOxy();
  const sendMessage = useSendMessage();
  const saveDraftMutation = useSaveDraft();
  const bodyRef = useRef<TextInput>(null);

  const [to, setTo] = useState(initialTo || '');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(initialSubject || '');
  const [body, setBody] = useState(initialBody || '');
  const [showCcBcc, setShowCcBcc] = useState(false);

  const fromAddress = user?.username ? `${user.username}@oxy.so` : '';
  const sending = sendMessage.isPending;

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const parseAddresses = (input: string) => {
    return input
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((addr) => isValidEmail(addr))
      .map((addr) => ({ address: addr }));
  };

  const handleSend = useCallback(() => {
    if (!to.trim()) {
      toast.error('Please add at least one recipient.');
      return;
    }

    const toAddresses = parseAddresses(to);
    if (toAddresses.length === 0) {
      toast.error('Please enter a valid email address.');
      return;
    }

    sendMessage.mutate(
      {
        to: toAddresses,
        cc: cc.trim() ? parseAddresses(cc) : undefined,
        bcc: bcc.trim() ? parseAddresses(bcc) : undefined,
        subject,
        text: body,
        inReplyTo: replyTo,
      },
      {
        onSuccess: () => router.back(),
        onError: (err: any) =>
          toast.error(err.message || 'Unable to send email. Please try again.'),
      },
    );
  }, [to, cc, bcc, subject, body, replyTo, sendMessage, router]);

  const handleSaveDraft = useCallback(() => {
    saveDraftMutation.mutate(
      {
        to: to.trim() ? parseAddresses(to) : undefined,
        cc: cc.trim() ? parseAddresses(cc) : undefined,
        bcc: bcc.trim() ? parseAddresses(bcc) : undefined,
        subject,
        text: body,
        inReplyTo: replyTo,
      },
      { onSettled: () => router.back() },
    );
  }, [to, cc, bcc, subject, body, replyTo, saveDraftMutation, router]);

  const handleClose = useCallback(() => {
    if (to.trim() || subject.trim() || body.trim()) {
      handleSaveDraft();
    } else {
      router.back();
    }
  }, [to, subject, body, handleSaveDraft, router]);

  return (
    <KeyboardAvoidingView
      style={[
        styles.container,
        { backgroundColor: colors.background },
        mode === 'standalone' && { paddingTop: insets.top },
      ]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {mode === 'standalone' && (
          <TouchableOpacity onPress={handleClose} style={styles.iconButton}>
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={Cancel01Icon as unknown as IconSvgElement} size={24} color={colors.icon} />
            ) : (
              <MaterialCommunityIcons name="close" size={24} color={colors.icon} />
            )}
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {replyTo ? 'Reply' : forward ? 'Forward' : 'Compose'}
        </Text>
        <View style={styles.headerSpacer} />
        <TouchableOpacity onPress={handleSaveDraft} style={styles.iconButton}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={FloppyDiskIcon as unknown as IconSvgElement} size={22} color={colors.icon} />
          ) : (
            <MaterialCommunityIcons name="content-save-outline" size={22} color={colors.icon} />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSend}
          style={[styles.sendButton, { backgroundColor: colors.primary, opacity: sending ? 0.5 : 1 }]}
          disabled={sending}
        >
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={MailSend01Icon as unknown as IconSvgElement} size={20} color="#FFFFFF" />
          ) : (
            <MaterialCommunityIcons name="send" size={20} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
        {/* From */}
        <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>From</Text>
          <Text style={[styles.fromAddress, { color: colors.text }]}>{fromAddress}</Text>
        </View>

        {/* To */}
        <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>To</Text>
          <TextInput
            style={[styles.fieldInput, { color: colors.text }]}
            value={to}
            onChangeText={setTo}
            placeholder="Recipients"
            placeholderTextColor={colors.searchPlaceholder}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {!showCcBcc && (
            <TouchableOpacity onPress={() => setShowCcBcc(true)}>
              {Platform.OS === 'web' ? (
                <HugeiconsIcon icon={ArrowDown01Icon as unknown as IconSvgElement} size={20} color={colors.secondaryText} />
              ) : (
                <MaterialCommunityIcons name="chevron-down" size={20} color={colors.secondaryText} />
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Cc / Bcc */}
        {showCcBcc && (
          <>
            <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>Cc</Text>
              <TextInput
                style={[styles.fieldInput, { color: colors.text }]}
                value={cc}
                onChangeText={setCc}
                placeholder=""
                placeholderTextColor={colors.searchPlaceholder}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>Bcc</Text>
              <TextInput
                style={[styles.fieldInput, { color: colors.text }]}
                value={bcc}
                onChangeText={setBcc}
                placeholder=""
                placeholderTextColor={colors.searchPlaceholder}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </>
        )}

        {/* Subject */}
        <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
          <TextInput
            style={[styles.subjectInput, { color: colors.text }]}
            value={subject}
            onChangeText={setSubject}
            placeholder="Subject"
            placeholderTextColor={colors.searchPlaceholder}
          />
        </View>

        {/* Body */}
        <TextInput
          ref={bodyRef}
          style={[styles.bodyInput, { color: colors.text }]}
          value={body}
          onChangeText={setBody}
          placeholder="Compose email"
          placeholderTextColor={colors.searchPlaceholder}
          multiline
          textAlignVertical="top"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '500',
    flex: 0,
    marginLeft: 4,
  },
  headerSpacer: {
    flex: 1,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  sendButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  form: {
    flex: 1,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  fieldLabel: {
    fontSize: 14,
    width: 36,
  },
  fieldInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  fromAddress: {
    fontSize: 15,
    flex: 1,
  },
  subjectInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  bodyInput: {
    flex: 1,
    fontSize: 15,
    lineHeight: 24,
    padding: 16,
    minHeight: 300,
  },
});
