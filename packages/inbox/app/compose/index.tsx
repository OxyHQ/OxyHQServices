/**
 * Compose / Reply / Forward email screen.
 *
 * Presented as a modal with Gmail-style compose UI.
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
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { emailApi } from '@/services/emailApi';

export default function ComposeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    replyTo?: string;
    forward?: string;
    to?: string;
    toName?: string;
    subject?: string;
    body?: string;
  }>();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const { user, oxyServices } = useOxy();
  const bodyRef = useRef<TextInput>(null);

  const [to, setTo] = useState(params.to || '');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(params.subject || '');
  const [body, setBody] = useState(params.body || '');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [sending, setSending] = useState(false);

  const fromAddress = user?.username ? `${user.username}@oxy.so` : '';

  const parseAddresses = (input: string) => {
    return input
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((addr) => ({ address: addr }));
  };

  const handleSend = useCallback(async () => {
    if (!to.trim()) {
      Alert.alert('Error', 'Please add at least one recipient.');
      return;
    }

    setSending(true);
    try {
      const token = oxyServices.httpService.getAccessToken();
      if (!token) throw new Error('Not authenticated');

      await emailApi.sendMessage(token, {
        to: parseAddresses(to),
        cc: cc.trim() ? parseAddresses(cc) : undefined,
        bcc: bcc.trim() ? parseAddresses(bcc) : undefined,
        subject,
        text: body,
        inReplyTo: params.replyTo,
      });

      router.back();
    } catch (err: any) {
      Alert.alert('Send failed', err.message || 'Unable to send email. Please try again.');
    } finally {
      setSending(false);
    }
  }, [to, cc, bcc, subject, body, params.replyTo, oxyServices, router]);

  const handleSaveDraft = useCallback(async () => {
    try {
      const token = oxyServices.httpService.getAccessToken();
      if (!token) return;

      await emailApi.saveDraft(token, {
        to: to.trim() ? parseAddresses(to) : undefined,
        cc: cc.trim() ? parseAddresses(cc) : undefined,
        bcc: bcc.trim() ? parseAddresses(bcc) : undefined,
        subject,
        text: body,
        inReplyTo: params.replyTo,
      });
    } catch {}
    router.back();
  }, [to, cc, bcc, subject, body, params.replyTo, oxyServices, router]);

  const handleClose = useCallback(() => {
    if (to.trim() || subject.trim() || body.trim()) {
      handleSaveDraft();
    } else {
      router.back();
    }
  }, [to, subject, body, handleSaveDraft, router]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleClose} style={styles.iconButton}>
          <MaterialCommunityIcons name="close" size={24} color={colors.icon} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {params.replyTo ? 'Reply' : params.forward ? 'Forward' : 'Compose'}
        </Text>
        <View style={styles.headerSpacer} />
        <TouchableOpacity onPress={handleSaveDraft} style={styles.iconButton}>
          <MaterialCommunityIcons name="content-save-outline" size={22} color={colors.icon} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSend}
          style={[styles.sendButton, { backgroundColor: colors.primary, opacity: sending ? 0.5 : 1 }]}
          disabled={sending}
        >
          <MaterialCommunityIcons name="send" size={20} color="#FFFFFF" />
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
              <MaterialCommunityIcons name="chevron-down" size={20} color={colors.secondaryText} />
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
