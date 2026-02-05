/**
 * Gmail-like inline reply component.
 *
 * Appears at the bottom of MessageDetail for quick replies
 * without navigating to a separate compose page.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  MailSend01Icon,
  Cancel01Icon,
  Attachment01Icon,
  ArrowDown01Icon,
} from '@hugeicons/core-free-icons';
import { useOxy, toast } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useEmailStore } from '@/hooks/useEmail';
import { useSendMessage } from '@/hooks/mutations/useMessageMutations';
import { Avatar } from '@/components/Avatar';
import type { Message, Attachment, EmailAddress } from '@/services/emailApi';

function formatQuoteDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatQuotedText(message: Message): string {
  const header = `On ${formatQuoteDate(message.date)}, ${message.from.name || message.from.address} wrote:`;
  const originalText = message.text || '';
  const quoted = originalText
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `\n\n${header}\n${quoted}`;
}

interface InlineReplyProps {
  message: Message;
  mode: 'reply' | 'reply-all' | 'forward';
  onClose: () => void;
  onSent?: () => void;
}

export function InlineReply({ message, mode, onClose, onSent }: InlineReplyProps) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const { user } = useOxy();
  const api = useEmailStore((s) => s._api);
  const sendMessage = useSendMessage();
  const bodyRef = useRef<TextInput>(null);

  // Compute initial recipients based on mode
  const initialTo = useMemo(() => {
    if (mode === 'forward') return '';
    if (mode === 'reply-all') {
      const allTo = [message.from, ...(message.to || [])];
      return allTo.map((a) => a.address).join(', ');
    }
    return message.from.address;
  }, [mode, message]);

  const initialCc = useMemo(() => {
    if (mode === 'reply-all' && message.cc) {
      return message.cc.map((a) => a.address).join(', ');
    }
    return '';
  }, [mode, message]);

  const initialSubject = useMemo(() => {
    if (mode === 'forward') {
      return message.subject.startsWith('Fwd:') ? message.subject : `Fwd: ${message.subject}`;
    }
    return message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`;
  }, [mode, message]);

  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState(initialCc);
  const [bcc, setBcc] = useState('');
  const [body, setBody] = useState('');
  const [quotedText, setQuotedText] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(!!initialCc);
  const [showRecipients, setShowRecipients] = useState(mode === 'forward');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [signatureLoaded, setSignatureLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Load signature and quoted text on mount
  useEffect(() => {
    if (!api || signatureLoaded) return;

    const setup = async () => {
      let signature = '';
      try {
        const settings = await api.getSettings();
        if (settings.signature) {
          signature = `\n\n--\n${settings.signature}`;
        }
      } catch {
        // Signature is optional
      }

      if (mode === 'forward') {
        const forwardBody = `\n\n---------- Forwarded message ----------\nFrom: ${message.from.name || message.from.address}\nDate: ${formatQuoteDate(message.date)}\nSubject: ${message.subject}\nTo: ${message.to.map((a) => a.name || a.address).join(', ')}\n\n${message.text || ''}`;
        setQuotedText(forwardBody);
      } else {
        setQuotedText(formatQuotedText(message));
      }

      // Place signature after body placeholder, before quoted text
      setBody(signature);
      setSignatureLoaded(true);
    };

    setup();
  }, [api, signatureLoaded, message, mode]);

  const fromAddress = user?.username ? `${user.username}@oxy.so` : '';
  const sending = sendMessage.isPending;
  const userName = typeof user?.name === 'string' ? user.name : user?.username || 'Me';

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const parseAddresses = (input: string): EmailAddress[] => {
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

    const fullBody = body + quotedText;

    sendMessage.mutate(
      {
        to: toAddresses,
        cc: cc.trim() ? parseAddresses(cc) : undefined,
        bcc: bcc.trim() ? parseAddresses(bcc) : undefined,
        subject: initialSubject,
        text: fullBody,
        inReplyTo: mode !== 'forward' ? message._id : undefined,
        references: mode !== 'forward' && message.references ? [...message.references, message.messageId] : undefined,
        attachments: attachments.length > 0 ? attachments.map((a) => a.s3Key) : undefined,
      },
      {
        onSuccess: () => {
          onSent?.();
          onClose();
        },
        onError: (err: any) =>
          toast.error(err.message || 'Unable to send email. Please try again.'),
      },
    );
  }, [to, cc, bcc, body, quotedText, initialSubject, message, mode, attachments, sendMessage, onClose, onSent]);

  const handleDiscard = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleExpand = useCallback(() => {
    setExpanded(true);
    setTimeout(() => bodyRef.current?.focus(), 100);
  }, []);

  const senderName = message.from.name || message.from.address.split('@')[0];

  // Collapsed state - just shows click to expand
  if (!expanded) {
    return (
      <TouchableOpacity
        style={[styles.collapsedContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={handleExpand}
        activeOpacity={0.8}
      >
        <Avatar name={userName} size={32} />
        <Text style={[styles.collapsedPlaceholder, { color: colors.secondaryText }]}>
          {mode === 'forward' ? 'Forward this message...' : `Reply to ${senderName}...`}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Avatar name={userName} size={32} />
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {mode === 'forward' ? 'Forward' : mode === 'reply-all' ? 'Reply All' : 'Reply'}
          </Text>
          <Text style={[styles.headerFrom, { color: colors.secondaryText }]} numberOfLines={1}>
            {fromAddress}
          </Text>
        </View>
        <TouchableOpacity onPress={handleDiscard} style={styles.closeButton}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={Cancel01Icon as unknown as IconSvgElement} size={20} color={colors.icon} />
          ) : (
            <MaterialCommunityIcons name="close" size={20} color={colors.icon} />
          )}
        </TouchableOpacity>
      </View>

      {/* Recipients - collapsible */}
      <TouchableOpacity
        style={[styles.recipientRow, { borderBottomColor: colors.border }]}
        onPress={() => setShowRecipients(!showRecipients)}
        activeOpacity={0.7}
      >
        <Text style={[styles.recipientLabel, { color: colors.secondaryText }]}>To:</Text>
        <Text style={[styles.recipientValue, { color: colors.text }]} numberOfLines={1}>
          {to || 'Add recipients'}
        </Text>
        <MaterialCommunityIcons
          name={showRecipients ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.secondaryText}
        />
      </TouchableOpacity>

      {showRecipients && (
        <View style={[styles.recipientsExpanded, { borderBottomColor: colors.border }]}>
          <View style={styles.recipientInputRow}>
            <Text style={[styles.recipientInputLabel, { color: colors.secondaryText }]}>To</Text>
            <TextInput
              style={[styles.recipientInput, { color: colors.text }]}
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
                <Text style={[styles.ccBccToggle, { color: colors.primary }]}>Cc/Bcc</Text>
              </TouchableOpacity>
            )}
          </View>
          {showCcBcc && (
            <>
              <View style={styles.recipientInputRow}>
                <Text style={[styles.recipientInputLabel, { color: colors.secondaryText }]}>Cc</Text>
                <TextInput
                  style={[styles.recipientInput, { color: colors.text }]}
                  value={cc}
                  onChangeText={setCc}
                  placeholder=""
                  placeholderTextColor={colors.searchPlaceholder}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.recipientInputRow}>
                <Text style={[styles.recipientInputLabel, { color: colors.secondaryText }]}>Bcc</Text>
                <TextInput
                  style={[styles.recipientInput, { color: colors.text }]}
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
        </View>
      )}

      {/* Body */}
      <TextInput
        ref={bodyRef}
        style={[styles.bodyInput, { color: colors.text }]}
        value={body}
        onChangeText={setBody}
        placeholder="Write your reply..."
        placeholderTextColor={colors.searchPlaceholder}
        multiline
        textAlignVertical="top"
        autoFocus
      />

      {/* Quoted text preview */}
      <TouchableOpacity
        style={[styles.quotedPreview, { backgroundColor: colors.surfaceVariant }]}
        activeOpacity={0.8}
      >
        <View style={[styles.quotedLine, { backgroundColor: colors.primary }]} />
        <Text style={[styles.quotedText, { color: colors.secondaryText }]} numberOfLines={3}>
          {quotedText.slice(0, 200)}...
        </Text>
      </TouchableOpacity>

      {/* Attachments */}
      {attachments.length > 0 && (
        <View style={styles.attachmentsSection}>
          {attachments.map((att, i) => (
            <View key={i} style={[styles.attachmentChip, { backgroundColor: colors.surfaceVariant }]}>
              <MaterialCommunityIcons name="paperclip" size={12} color={colors.secondaryText} />
              <Text style={[styles.attachmentName, { color: colors.text }]} numberOfLines={1}>
                {att.filename}
              </Text>
              <TouchableOpacity onPress={() => handleRemoveAttachment(i)} hitSlop={4}>
                <MaterialCommunityIcons name="close-circle" size={14} color={colors.secondaryText} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Footer actions */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity onPress={handleAttachFile} style={styles.footerButton} disabled={uploading}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon
              icon={Attachment01Icon as unknown as IconSvgElement}
              size={20}
              color={uploading ? colors.secondaryText : colors.icon}
            />
          ) : (
            <MaterialCommunityIcons
              name="paperclip"
              size={20}
              color={uploading ? colors.secondaryText : colors.icon}
            />
          )}
        </TouchableOpacity>

        {/* Formatting toolbar */}
        <View style={styles.formattingToolbar}>
          <TouchableOpacity
            onPress={() => setBody((prev) => prev + '**bold**')}
            style={styles.formatButton}
          >
            <MaterialCommunityIcons name="format-bold" size={18} color={colors.icon} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setBody((prev) => prev + '*italic*')}
            style={styles.formatButton}
          >
            <MaterialCommunityIcons name="format-italic" size={18} color={colors.icon} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setBody((prev) => prev + '[link text](https://)')}
            style={styles.formatButton}
          >
            <MaterialCommunityIcons name="link" size={18} color={colors.icon} />
          </TouchableOpacity>
        </View>

        <View style={styles.footerSpacer} />

        <TouchableOpacity
          onPress={handleDiscard}
          style={[styles.discardButton, { borderColor: colors.border }]}
        >
          <Text style={[styles.discardButtonText, { color: colors.text }]}>Discard</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSend}
          style={[styles.sendButton, { backgroundColor: colors.primary, opacity: sending ? 0.5 : 1 }]}
          disabled={sending}
        >
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={MailSend01Icon as unknown as IconSvgElement} size={18} color="#FFFFFF" />
          ) : (
            <MaterialCommunityIcons name="send" size={18} color="#FFFFFF" />
          )}
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  collapsedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  collapsedPlaceholder: {
    fontSize: 14,
    flex: 1,
  },
  container: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  headerFrom: {
    fontSize: 12,
    marginTop: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  recipientLabel: {
    fontSize: 13,
  },
  recipientValue: {
    fontSize: 13,
    flex: 1,
  },
  recipientsExpanded: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  recipientInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recipientInputLabel: {
    fontSize: 13,
    width: 28,
  },
  recipientInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 4,
  },
  ccBccToggle: {
    fontSize: 13,
    fontWeight: '500',
  },
  bodyInput: {
    fontSize: 14,
    lineHeight: 22,
    padding: 12,
    minHeight: 100,
    maxHeight: 200,
  },
  quotedPreview: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  quotedLine: {
    width: 3,
  },
  quotedText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    padding: 8,
  },
  attachmentsSection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  attachmentName: {
    fontSize: 11,
    maxWidth: 100,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  footerButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  footerSpacer: {
    flex: 1,
  },
  discardButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  discardButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
  },
  sendButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  formattingToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  formatButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
});
