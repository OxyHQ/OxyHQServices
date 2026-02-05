/**
 * Reusable compose / reply / forward form.
 *
 * Supports attachments, Cc/Bcc toggle, and discard confirmation.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
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
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Cancel01Icon,
  FloppyDiskIcon,
  MailSend01Icon,
  ArrowDown01Icon,
  Attachment01Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy, toast } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useEmailStore } from '@/hooks/useEmail';
import { useSendMessageWithUndo, useSaveDraft } from '@/hooks/mutations/useMessageMutations';
import type { Attachment } from '@/services/emailApi';

interface ComposeFormProps {
  mode: 'standalone' | 'embedded';
  replyTo?: string;
  forward?: string;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
}

export function ComposeForm({ mode, replyTo, forward, to: initialTo, cc: initialCc, subject: initialSubject, body: initialBody }: ComposeFormProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const { user } = useOxy();
  const api = useEmailStore((s) => s._api);
  const { sendWithUndo, isPending: sendPending } = useSendMessageWithUndo();
  const saveDraftMutation = useSaveDraft();
  const bodyRef = useRef<TextInput>(null);

  const [to, setTo] = useState(initialTo || '');
  const [cc, setCc] = useState(initialCc || '');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(initialSubject || '');
  const [body, setBody] = useState(initialBody || '');
  const [showCcBcc, setShowCcBcc] = useState(!!(initialCc));
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [signatureLoaded, setSignatureLoaded] = useState(false);

  // Auto-insert signature from settings
  useEffect(() => {
    if (!api || signatureLoaded) return;

    const loadSignature = async () => {
      try {
        const settings = await api.getSettings();
        if (settings.signature && !initialBody) {
          // Add signature with separator
          setBody(`\n\n--\n${settings.signature}`);
        }
      } catch {
        // Silently fail - signature is optional
      }
      setSignatureLoaded(true);
    };

    loadSignature();
  }, [api, signatureLoaded, initialBody]);

  const fromAddress = user?.username ? `${user.username}@oxy.so` : '';
  const sending = sendPending;
  const hasContent = to.trim() || subject.trim() || body.trim() || attachments.length > 0;

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const parseAddresses = (input: string) => {
    return input
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((addr) => isValidEmail(addr))
      .map((addr) => ({ address: addr }));
  };

  const handleAttachFile = useCallback(async () => {
    if (!api) return;
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.onchange = async () => {
        if (!input.files) return;
        setUploading(true);
        try {
          for (const file of Array.from(input.files)) {
            const attachment = await api.uploadAttachment(file, file.name);
            setAttachments((prev) => [...prev, attachment]);
          }
        } catch {
          toast.error('Failed to upload attachment.');
        }
        setUploading(false);
      };
      input.click();
    } else {
      try {
        const DocumentPicker = require('expo-document-picker');
        const result = await DocumentPicker.getDocumentAsync({ multiple: true });
        if (result.canceled) return;
        setUploading(true);
        for (const asset of result.assets) {
          const response = await fetch(asset.uri);
          const blob = await response.blob();
          const attachment = await api.uploadAttachment(blob, asset.name);
          setAttachments((prev) => [...prev, attachment]);
        }
      } catch {
        toast.error('Failed to upload attachment.');
      }
      setUploading(false);
    }
  }, [api]);

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

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

    sendWithUndo(
      {
        to: toAddresses,
        cc: cc.trim() ? parseAddresses(cc) : undefined,
        bcc: bcc.trim() ? parseAddresses(bcc) : undefined,
        subject,
        text: body,
        inReplyTo: replyTo,
        attachments: attachments.length > 0 ? attachments.map((a) => a.s3Key) : undefined,
      },
      {
        onSuccess: () => router.back(),
        onError: (err: any) =>
          toast.error(err.message || 'Unable to send email. Please try again.'),
      },
    );
  }, [to, cc, bcc, subject, body, replyTo, attachments, sendWithUndo, router]);

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
    if (hasContent) {
      if (Platform.OS === 'web') {
        if (window.confirm('Save as draft?')) {
          handleSaveDraft();
        } else {
          router.back();
        }
      } else {
        Alert.alert(
          'Save draft?',
          'Do you want to save this message as a draft?',
          [
            { text: 'Discard', style: 'destructive', onPress: () => router.back() },
            { text: 'Save', onPress: handleSaveDraft },
          ],
          { cancelable: true },
        );
      }
    } else {
      router.back();
    }
  }, [hasContent, handleSaveDraft, router]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

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
        <TouchableOpacity onPress={handleAttachFile} style={styles.iconButton} disabled={uploading}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={Attachment01Icon as unknown as IconSvgElement} size={22} color={uploading ? colors.secondaryText : colors.icon} />
          ) : (
            <MaterialCommunityIcons name="paperclip" size={22} color={uploading ? colors.secondaryText : colors.icon} />
          )}
        </TouchableOpacity>
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

        {/* Attachments */}
        {attachments.length > 0 && (
          <View style={[styles.attachmentsSection, { borderBottomColor: colors.border }]}>
            {attachments.map((att, i) => (
              <View key={i} style={[styles.attachmentChip, { backgroundColor: colors.surfaceVariant }]}>
                <MaterialCommunityIcons name="paperclip" size={14} color={colors.secondaryText} />
                <Text style={[styles.attachmentName, { color: colors.text }]} numberOfLines={1}>
                  {att.filename}
                </Text>
                <Text style={[styles.attachmentSize, { color: colors.secondaryText }]}>
                  {formatSize(att.size)}
                </Text>
                <TouchableOpacity onPress={() => handleRemoveAttachment(i)} hitSlop={4}>
                  <MaterialCommunityIcons name="close-circle" size={16} color={colors.secondaryText} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Formatting toolbar */}
        <View style={[styles.formattingToolbar, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => setBody((prev) => prev + '**bold**')}
            style={styles.formatButton}
          >
            <MaterialCommunityIcons name="format-bold" size={20} color={colors.icon} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setBody((prev) => prev + '*italic*')}
            style={styles.formatButton}
          >
            <MaterialCommunityIcons name="format-italic" size={20} color={colors.icon} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setBody((prev) => prev + '[link text](https://)')}
            style={styles.formatButton}
          >
            <MaterialCommunityIcons name="link" size={20} color={colors.icon} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setBody((prev) => prev + '\n- ')}
            style={styles.formatButton}
          >
            <MaterialCommunityIcons name="format-list-bulleted" size={20} color={colors.icon} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setBody((prev) => prev + '\n1. ')}
            style={styles.formatButton}
          >
            <MaterialCommunityIcons name="format-list-numbered" size={20} color={colors.icon} />
          </TouchableOpacity>
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
  attachmentsSection: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  attachmentName: {
    fontSize: 13,
    flex: 1,
  },
  attachmentSize: {
    fontSize: 11,
  },
  bodyInput: {
    flex: 1,
    fontSize: 15,
    lineHeight: 24,
    padding: 16,
    minHeight: 300,
  },
  formattingToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  formatButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
});
