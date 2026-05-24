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
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Prompt from '@oxyhq/bloom/prompt';
import * as Dialog from '@oxyhq/bloom/dialog';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Cancel01Icon,
  FloppyDiskIcon,
  MailSend01Icon,
  ArrowDown01Icon,
  Attachment01Icon,
  Clock01Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy, toast } from '@oxyhq/services';

import { useColors } from '@/constants/theme';
import { useEmailStore } from '@/hooks/useEmail';
import { useSendMessageWithUndo, useSendMessage, useSaveDraft } from '@/hooks/mutations/useMessageMutations';
import { useContactSuggestions } from '@/hooks/queries/useContactSuggestions';
import { AiComposeToolbar } from '@/components/AiComposeToolbar';
import { RichTextEditor, stripHtml, type RichTextEditorHandle } from '@/components/RichTextEditor';
import { ScheduleSendSheet } from '@/components/ScheduleSendSheet';
import { TemplatePicker } from '@/components/TemplatePicker';
import type { Attachment, ContactSuggestion, EmailTemplate } from '@/services/emailApi';

const isWeb = Platform.OS === 'web';

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
  const colors = useColors();
  const { user } = useOxy();
  const api = useEmailStore((s) => s._api);
  const { sendWithUndo, isPending: sendPending } = useSendMessageWithUndo();
  const sendMessageMutation = useSendMessage();
  const saveDraftMutation = useSaveDraft();
  const bodyRef = useRef<RichTextEditorHandle>(null);

  const [to, setTo] = useState(initialTo || '');
  const [cc, setCc] = useState(initialCc || '');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(initialSubject || '');
  const [body, setBody] = useState(initialBody || '');
  const [showCcBcc, setShowCcBcc] = useState(!!(initialCc));
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [signatureLoaded, setSignatureLoaded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

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
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load signature.';
        toast.error(message);
      }
      setSignatureLoaded(true);
    };

    loadSignature();
  }, [api, signatureLoaded, initialBody]);

  const draftIdRef = useRef<string | null>(null);
  const sentRef = useRef(false);

  const fromAddress = user?.username ? `${user.username}@oxy.so` : '';
  const sending = sendPending;
  const hasContent = to.trim() || subject.trim() || body.trim() || attachments.length > 0;

  // Debounced auto-save draft: fires ~8s after the user stops editing.
  // Latest form values live in a ref so the debounce timer is not recreated
  // on each keystroke (which would prevent it from ever firing while typing).
  const latestDraftRef = useRef({ to, cc, bcc, subject, body, replyTo });
  latestDraftRef.current = { to, cc, bcc, subject, body, replyTo };

  const saveDraftMutate = saveDraftMutation.mutate;
  // biome-ignore lint/correctness/useExhaustiveDependencies: to/cc/bcc/subject/body are intentionally listed so each keystroke restarts the 8s debounce timer; the actual values are read from latestDraftRef at fire time.
  useEffect(() => {
    if (!api || !hasContent || sentRef.current) return;
    const timer = setTimeout(() => {
      if (sentRef.current) return;
      const snapshot = latestDraftRef.current;
      saveDraftMutate(
        {
          to: snapshot.to.trim() ? parseAddresses(snapshot.to) : undefined,
          cc: snapshot.cc.trim() ? parseAddresses(snapshot.cc) : undefined,
          bcc: snapshot.bcc.trim() ? parseAddresses(snapshot.bcc) : undefined,
          subject: snapshot.subject || undefined,
          text: isWeb ? stripHtml(snapshot.body) || undefined : snapshot.body || undefined,
          html: isWeb ? snapshot.body || undefined : undefined,
          inReplyTo: snapshot.replyTo,
          existingDraftId: draftIdRef.current ?? undefined,
        },
        {
          onSuccess: (draft) => {
            draftIdRef.current = draft._id;
          },
        },
      );
    }, 8_000);
    return () => clearTimeout(timer);
  }, [api, hasContent, to, cc, bcc, subject, body, saveDraftMutate]);

  // Contact autocomplete state — track which field is active and the current query
  const [activeField, setActiveField] = useState<'to' | 'cc' | 'bcc' | null>(null);
  const [autocompleteQuery, setAutocompleteQuery] = useState('');
  const { data: suggestions = [] } = useContactSuggestions(autocompleteQuery);

  // Extract the last email segment (after the last comma) as the autocomplete query
  const updateAutocomplete = useCallback((value: string, field: 'to' | 'cc' | 'bcc') => {
    setActiveField(field);
    const lastSegment = value.split(',').pop()?.trim() || '';
    setAutocompleteQuery(lastSegment);
  }, []);

  const handleSelectSuggestion = useCallback(
    (suggestion: ContactSuggestion, field: 'to' | 'cc' | 'bcc') => {
      const setter = field === 'to' ? setTo : field === 'cc' ? setCc : setBcc;
      setter((prev) => {
        const parts = prev.split(',').map((s) => s.trim()).filter(Boolean);
        // Replace the last (incomplete) segment with the selected address
        if (parts.length > 0) parts.pop();
        parts.push(suggestion.address);
        return parts.join(', ') + ', ';
      });
      setAutocompleteQuery('');
      setActiveField(null);
    },
    [],
  );

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
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to upload attachment.';
          toast.error(message);
        }
        setUploading(false);
      };
      input.click();
    } else {
      try {
        const result = await DocumentPicker.getDocumentAsync({ multiple: true });
        if (result.canceled) return;
        setUploading(true);
        for (const asset of result.assets) {
          const response = await fetch(asset.uri);
          const blob = await response.blob();
          const attachment = await api.uploadAttachment(blob, asset.name);
          setAttachments((prev) => [...prev, attachment]);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to upload attachment.';
        toast.error(message);
      }
      setUploading(false);
    }
  }, [api]);

  const handleDropFiles = useCallback(async (files: FileList) => {
    if (!api || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const attachment = await api.uploadAttachment(file, file.name);
        setAttachments((prev) => [...prev, attachment]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to upload attachment.';
      toast.error(message);
    }
    setUploading(false);
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

    sentRef.current = true;
    sendWithUndo(
      {
        to: toAddresses,
        cc: cc.trim() ? parseAddresses(cc) : undefined,
        bcc: bcc.trim() ? parseAddresses(bcc) : undefined,
        subject,
        text: isWeb ? stripHtml(body) : body,
        html: isWeb ? body : undefined,
        inReplyTo: replyTo,
        attachments: attachments.length > 0 ? attachments.map((a) => a.s3Key) : undefined,
      },
      {
        onSuccess: () => router.back(),
        onError: (err: any) => {
          sentRef.current = false;
          toast.error(err.message || 'Unable to send email. Please try again.');
        },
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
        text: isWeb ? stripHtml(body) : body,
        html: isWeb ? body : undefined,
        inReplyTo: replyTo,
        existingDraftId: draftIdRef.current ?? undefined,
      },
      {
        onSuccess: (draft) => {
          draftIdRef.current = draft._id;
        },
        onSettled: () => router.back(),
      },
    );
  }, [to, cc, bcc, subject, body, replyTo, saveDraftMutation, router]);

  const saveDraftPrompt = Prompt.usePromptControl();

  const handleClose = useCallback(() => {
    if (hasContent) {
      saveDraftPrompt.open();
    } else {
      router.back();
    }
  }, [hasContent, saveDraftPrompt, router]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Handle AI-suggested subject line
  const handleSubjectSuggested = useCallback((suggestedSubject: string) => {
    setSubject(suggestedSubject);
  }, []);

  // Handle template selection — insert into compose fields
  const handleTemplateSelect = useCallback((template: EmailTemplate) => {
    if (!subject.trim() && template.subject) {
      setSubject(template.subject);
    }
    if (!body.trim()) {
      if (isWeb && bodyRef.current) {
        bodyRef.current.setContent(template.body);
      } else {
        setBody(template.body);
      }
    } else {
      // Append template body
      const newBody = body + '\n' + template.body;
      if (isWeb && bodyRef.current) {
        bodyRef.current.setContent(newBody);
      } else {
        setBody(newBody);
      }
    }
  }, [subject, body]);

  // Handle body changes from AI toolbar — on web, insert into contentEditable
  const handleAiBodyChange = useCallback((text: string) => {
    if (isWeb && bodyRef.current) {
      bodyRef.current.setContent(text);
    } else {
      setBody(text);
    }
  }, []);

  // Schedule Send state
  const [showScheduleSheet, setShowScheduleSheet] = useState(false);
  const sendMenuControl = Dialog.useDialogControl();

  const handleScheduleSend = useCallback((scheduledDate: Date) => {
    if (!to.trim()) {
      toast.error('Please add at least one recipient.');
      return;
    }

    const toAddresses = parseAddresses(to);
    if (toAddresses.length === 0) {
      toast.error('Please enter a valid email address.');
      return;
    }

    sentRef.current = true;
    sendMessageMutation.mutate(
      {
        to: toAddresses,
        cc: cc.trim() ? parseAddresses(cc) : undefined,
        bcc: bcc.trim() ? parseAddresses(bcc) : undefined,
        subject,
        text: isWeb ? stripHtml(body) : body,
        html: isWeb ? body : undefined,
        inReplyTo: replyTo,
        attachments: attachments.length > 0 ? attachments.map((a) => a.s3Key) : undefined,
        scheduledAt: scheduledDate.toISOString(),
      },
      {
        onSuccess: () => {
          const timeStr = scheduledDate.toLocaleString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });
          toast.success(`Email scheduled for ${timeStr}`);
          router.back();
        },
        onError: (err: any) => {
          sentRef.current = false;
          toast.error(err.message || 'Failed to schedule email. Please try again.');
        },
      },
    );
  }, [to, cc, bcc, subject, body, replyTo, attachments, sendMessageMutation, router]);

  // Web drag-and-drop event handlers
  const webDropProps = useMemo(() => {
    if (Platform.OS !== 'web') return {};
    return {
      onDragEnter: (e: { preventDefault(): void; stopPropagation(): void; dataTransfer?: DataTransfer }) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current += 1;
        if (e.dataTransfer?.types?.includes('Files')) {
          setIsDragging(true);
        }
      },
      onDragOver: (e: { preventDefault(): void; stopPropagation(): void }) => {
        e.preventDefault();
        e.stopPropagation();
      },
      onDragLeave: (e: { preventDefault(): void; stopPropagation(): void }) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current -= 1;
        if (dragCounterRef.current === 0) {
          setIsDragging(false);
        }
      },
      onDrop: (e: { preventDefault(): void; stopPropagation(): void; dataTransfer?: DataTransfer }) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = 0;
        setIsDragging(false);
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          handleDropFiles(e.dataTransfer.files);
        }
      },
    };
  }, [handleDropFiles]);

  return (
    <KeyboardAvoidingView
      style={[
        styles.container,
        { backgroundColor: colors.background },
        mode === 'standalone' && { paddingTop: insets.top },
      ]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      {...webDropProps}
    >
      {/* Drop zone overlay (web only) */}
      {Platform.OS === 'web' && isDragging && (
        <View
          style={[
            styles.dropZoneOverlay,
            { borderColor: colors.primary, backgroundColor: colors.surface },
          ]}
          pointerEvents="none"
        >
          <MaterialCommunityIcons name="tray-arrow-down" size={40} color={colors.primary} />
          <Text style={[styles.dropZoneText, { color: colors.primary }]}>
            Drop files to attach
          </Text>
        </View>
      )}

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
        <TemplatePicker onSelect={handleTemplateSelect} />
        <TouchableOpacity onPress={handleSaveDraft} style={styles.iconButton}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={FloppyDiskIcon as unknown as IconSvgElement} size={22} color={colors.icon} />
          ) : (
            <MaterialCommunityIcons name="content-save-outline" size={22} color={colors.icon} />
          )}
        </TouchableOpacity>
        <View style={[styles.sendGroup, { backgroundColor: colors.primary, opacity: sending ? 0.5 : 1 }]}>
          <TouchableOpacity
            accessibilityLabel="Send"
            accessibilityRole="button"
            onPress={handleSend}
            style={styles.sendGroupPrimary}
            disabled={sending}
            activeOpacity={0.7}
          >
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={MailSend01Icon as unknown as IconSvgElement} size={20} color={colors.background} />
            ) : (
              <MaterialCommunityIcons name="send" size={20} color={colors.background} />
            )}
            <Text style={[styles.sendGroupLabel, { color: colors.background }]}>Send</Text>
          </TouchableOpacity>
          <View style={[styles.sendGroupDivider, { backgroundColor: colors.background }]} />
          <TouchableOpacity
            accessibilityLabel="More send options"
            accessibilityRole="button"
            onPress={() => sendMenuControl.open()}
            style={styles.sendGroupChevron}
            disabled={sending}
            activeOpacity={0.7}
          >
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={ArrowDown01Icon as unknown as IconSvgElement} size={16} color={colors.background} />
            ) : (
              <MaterialCommunityIcons name="chevron-down" size={18} color={colors.background} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Send-options menu */}
      <Dialog.Outer control={sendMenuControl}>
        <Dialog.Handle />
        <Dialog.Inner label="Send options" contentContainerStyle={{ padding: 0 }}>
          <TouchableOpacity
            style={styles.sendMenuItem}
            onPress={() => {
              sendMenuControl.close();
              handleSend();
            }}
            activeOpacity={0.6}
          >
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={MailSend01Icon as unknown as IconSvgElement} size={18} color={colors.icon} />
            ) : (
              <MaterialCommunityIcons name="send" size={18} color={colors.icon} />
            )}
            <Text style={[styles.sendMenuItemText, { color: colors.text }]}>Send now</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sendMenuItem}
            onPress={() => {
              sendMenuControl.close();
              setShowScheduleSheet(true);
            }}
            activeOpacity={0.6}
          >
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={Clock01Icon as unknown as IconSvgElement} size={18} color={colors.icon} />
            ) : (
              <MaterialCommunityIcons name="clock-outline" size={18} color={colors.icon} />
            )}
            <Text style={[styles.sendMenuItemText, { color: colors.text }]}>Schedule send</Text>
          </TouchableOpacity>
        </Dialog.Inner>
      </Dialog.Outer>

      <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
        {/* From */}
        <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>From</Text>
          <Text style={[styles.fromAddress, { color: colors.text }]}>{fromAddress}</Text>
        </View>

        {/* To */}
        <View style={{ zIndex: activeField === 'to' ? 10 : 1 }}>
          <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>To</Text>
            <TextInput
              style={[styles.fieldInput, { color: colors.text }]}
              value={to}
              onChangeText={(v) => { setTo(v); updateAutocomplete(v, 'to'); }}
              onFocus={() => updateAutocomplete(to, 'to')}
              onBlur={() => setTimeout(() => { if (activeField === 'to') setActiveField(null); }, 150)}
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
          {activeField === 'to' && suggestions.length > 0 && (
            <View style={[styles.suggestionsDropdown, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {suggestions.map((s) => (
                <TouchableOpacity key={s.address} style={styles.suggestionRow} onPress={() => handleSelectSuggestion(s, 'to')}>
                  <Text style={[styles.suggestionName, { color: colors.text }]} numberOfLines={1}>
                    {s.name || s.address}
                  </Text>
                  {s.name ? (
                    <Text style={[styles.suggestionAddress, { color: colors.secondaryText }]} numberOfLines={1}>
                      {s.address}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Cc / Bcc */}
        {showCcBcc && (
          <>
            <View style={{ zIndex: activeField === 'cc' ? 10 : 1 }}>
              <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>Cc</Text>
                <TextInput
                  style={[styles.fieldInput, { color: colors.text }]}
                  value={cc}
                  onChangeText={(v) => { setCc(v); updateAutocomplete(v, 'cc'); }}
                  onFocus={() => updateAutocomplete(cc, 'cc')}
                  onBlur={() => setTimeout(() => { if (activeField === 'cc') setActiveField(null); }, 150)}
                  placeholder=""
                  placeholderTextColor={colors.searchPlaceholder}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              {activeField === 'cc' && suggestions.length > 0 && (
                <View style={[styles.suggestionsDropdown, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  {suggestions.map((s) => (
                    <TouchableOpacity key={s.address} style={styles.suggestionRow} onPress={() => handleSelectSuggestion(s, 'cc')}>
                      <Text style={[styles.suggestionName, { color: colors.text }]} numberOfLines={1}>
                        {s.name || s.address}
                      </Text>
                      {s.name ? (
                        <Text style={[styles.suggestionAddress, { color: colors.secondaryText }]} numberOfLines={1}>
                          {s.address}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
            <View style={{ zIndex: activeField === 'bcc' ? 10 : 1 }}>
              <View style={[styles.fieldRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>Bcc</Text>
                <TextInput
                  style={[styles.fieldInput, { color: colors.text }]}
                  value={bcc}
                  onChangeText={(v) => { setBcc(v); updateAutocomplete(v, 'bcc'); }}
                  onFocus={() => updateAutocomplete(bcc, 'bcc')}
                  onBlur={() => setTimeout(() => { if (activeField === 'bcc') setActiveField(null); }, 150)}
                  placeholder=""
                  placeholderTextColor={colors.searchPlaceholder}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              {activeField === 'bcc' && suggestions.length > 0 && (
                <View style={[styles.suggestionsDropdown, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  {suggestions.map((s) => (
                    <TouchableOpacity key={s.address} style={styles.suggestionRow} onPress={() => handleSelectSuggestion(s, 'bcc')}>
                      <Text style={[styles.suggestionName, { color: colors.text }]} numberOfLines={1}>
                        {s.name || s.address}
                      </Text>
                      {s.name ? (
                        <Text style={[styles.suggestionAddress, { color: colors.secondaryText }]} numberOfLines={1}>
                          {s.address}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
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

        {/* AI Compose Toolbar */}
        <AiComposeToolbar
          body={body}
          onBodyChange={handleAiBodyChange}
          onSubjectSuggested={!subject.trim() ? handleSubjectSuggested : undefined}
        />

        {/* Body */}
        <RichTextEditor
          ref={bodyRef}
          value={body}
          onChange={setBody}
          placeholder="Compose email"
        />
      </ScrollView>

      {/* Schedule Send Sheet */}
      <ScheduleSendSheet
        visible={showScheduleSheet}
        onClose={() => setShowScheduleSheet(false)}
        onSchedule={handleScheduleSend}
      />

      {/* Save as draft confirmation */}
      <Prompt.Outer control={saveDraftPrompt} onClose={() => router.back()}>
        <Prompt.Content>
          <Prompt.TitleText>Save draft?</Prompt.TitleText>
          <Prompt.DescriptionText>Do you want to save this message as a draft?</Prompt.DescriptionText>
        </Prompt.Content>
        <Prompt.Actions>
          <Prompt.Action cta="Save" onPress={handleSaveDraft} color="primary" />
          <Prompt.Action cta="Discard" onPress={() => router.back()} color="negative" />
          <Prompt.Cancel />
        </Prompt.Actions>
      </Prompt.Outer>
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
  sendGroup: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    marginHorizontal: 4,
  },
  sendGroupPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 6,
  },
  sendGroupLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  sendGroupDivider: {
    width: StyleSheet.hairlineWidth,
    opacity: 0.4,
    marginVertical: 8,
  },
  sendGroupChevron: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  sendMenuItemText: {
    fontSize: 15,
    fontWeight: '500',
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
  suggestionsDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    maxHeight: 200,
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }
      : { elevation: 4 }),
  },
  suggestionRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  suggestionName: {
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 1,
  },
  suggestionAddress: {
    fontSize: 13,
    flexShrink: 0,
  },
  dropZoneOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 12,
    margin: 8,
    opacity: 0.9,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dropZoneText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
