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
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useOxy, toast } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useEmailStore } from '@/hooks/useEmail';
import { useSendMessageWithUndo } from '@/hooks/mutations/useMessageMutations';
import { Avatar } from '@/components/Avatar';
import { SmartReplyChips } from '@/components/SmartReplyChips';
import type { Message, EmailAddress } from '@/services/emailApi';

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
  const { sendWithUndo, isPending: sendPending } = useSendMessageWithUndo();
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
  const [signatureLoaded, setSignatureLoaded] = useState(false);

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

      setBody(signature);
      setSignatureLoaded(true);
    };

    setup();
  }, [api, signatureLoaded, message, mode]);

  const userName = typeof user?.name === 'string' ? user.name : user?.username || 'Me';
  const sending = sendPending;

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const parseAddresses = (input: string): EmailAddress[] => {
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

    const fullBody = body + quotedText;

    sendWithUndo(
      {
        to: toAddresses,
        cc: cc.trim() ? parseAddresses(cc) : undefined,
        bcc: bcc.trim() ? parseAddresses(bcc) : undefined,
        subject: initialSubject,
        text: fullBody,
        inReplyTo: mode !== 'forward' ? message._id : undefined,
        references: mode !== 'forward' && message.references ? [...message.references, message.messageId] : undefined,
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
  }, [to, cc, bcc, body, quotedText, initialSubject, message, mode, sendWithUndo, onClose, onSent]);

  const senderName = message.from.name || message.from.address.split('@')[0];

  // Handle smart reply selection - insert the text into the body
  const handleSmartReplySelect = useCallback((text: string) => {
    setBody((prev) => {
      // If there's already content, add a newline before the smart reply
      if (prev.trim()) {
        return text + '\n\n' + prev;
      }
      return text + prev;
    });
    // Focus the body input after selection
    bodyRef.current?.focus();
  }, []);

  // Only show smart replies for reply/reply-all, not forward
  const showSmartReplies = mode !== 'forward';

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header row with avatar and close */}
      <View style={styles.header}>
        <Avatar name={userName} size={36} />
        <View style={styles.headerContent}>
          <View style={styles.toRow}>
            <Text style={[styles.toLabel, { color: colors.secondaryText }]}>
              {mode === 'forward' ? 'Forward to:' : mode === 'reply-all' ? 'Reply all to:' : 'Reply to:'}
            </Text>
            <TextInput
              style={[styles.toInput, { color: colors.text }]}
              value={to}
              onChangeText={setTo}
              placeholder={mode === 'forward' ? 'Add recipients' : senderName}
              placeholderTextColor={colors.searchPlaceholder}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {!showCcBcc && (
              <TouchableOpacity onPress={() => setShowCcBcc(true)} style={styles.ccBccButton}>
                <Text style={[styles.ccBccText, { color: colors.primary }]}>Cc/Bcc</Text>
              </TouchableOpacity>
            )}
          </View>
          {showCcBcc && (
            <>
              <View style={styles.toRow}>
                <Text style={[styles.toLabel, { color: colors.secondaryText }]}>Cc:</Text>
                <TextInput
                  style={[styles.toInput, { color: colors.text }]}
                  value={cc}
                  onChangeText={setCc}
                  placeholder=""
                  placeholderTextColor={colors.searchPlaceholder}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.toRow}>
                <Text style={[styles.toLabel, { color: colors.secondaryText }]}>Bcc:</Text>
                <TextInput
                  style={[styles.toInput, { color: colors.text }]}
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
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <MaterialCommunityIcons name="close" size={20} color={colors.icon} />
        </TouchableOpacity>
      </View>

      {/* Smart reply suggestions */}
      {showSmartReplies && (
        <SmartReplyChips message={message} onSelectReply={handleSmartReplySelect} />
      )}

      {/* Body textarea */}
      <TextInput
        ref={bodyRef}
        style={[styles.bodyInput, { color: colors.text, borderTopColor: colors.border }]}
        value={body}
        onChangeText={setBody}
        placeholder="Write your reply..."
        placeholderTextColor={colors.searchPlaceholder}
        multiline
        textAlignVertical="top"
        autoFocus
      />

      {/* Quoted text indicator */}
      <TouchableOpacity style={[styles.quotedIndicator, { borderTopColor: colors.border }]} activeOpacity={0.7}>
        <View style={[styles.quotedDots, { backgroundColor: colors.secondaryText }]} />
        <Text style={[styles.quotedLabel, { color: colors.secondaryText }]} numberOfLines={1}>
          {quotedText.slice(0, 60).replace(/\n/g, ' ')}...
        </Text>
      </TouchableOpacity>

      {/* Footer with send button */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          onPress={handleSend}
          style={[styles.sendButton, { backgroundColor: colors.primary, opacity: sending ? 0.6 : 1 }]}
          disabled={sending}
        >
          <Text style={styles.sendButtonText}>Send</Text>
          <MaterialCommunityIcons name="send" size={16} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.footerActions} />

        <TouchableOpacity onPress={onClose} style={styles.footerAction}>
          <MaterialCommunityIcons name="delete-outline" size={20} color={colors.icon} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    ...Platform.select({
      web: { boxShadow: '0 1px 3px rgba(0,0,0,0.12)' } as any,
      default: { elevation: 2 },
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    gap: 12,
  },
  headerContent: {
    flex: 1,
    gap: 4,
  },
  toRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  toLabel: {
    fontSize: 13,
    minWidth: 70,
  },
  toInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 2,
  },
  ccBccButton: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  ccBccText: {
    fontSize: 13,
    fontWeight: '500',
  },
  closeButton: {
    padding: 4,
  },
  bodyInput: {
    fontSize: 14,
    lineHeight: 22,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 120,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  quotedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  quotedDots: {
    width: 16,
    height: 4,
    borderRadius: 2,
    opacity: 0.5,
  },
  quotedLabel: {
    flex: 1,
    fontSize: 12,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  sendButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  footerActions: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginLeft: 8,
    gap: 4,
  },
  footerAction: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
});
