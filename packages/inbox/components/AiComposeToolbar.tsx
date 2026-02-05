/**
 * AI Compose Toolbar component.
 *
 * Provides AI-powered composition tools:
 * - ✨ Draft for me - Generate email from prompt
 * - Polish - Fix grammar and improve clarity
 * - Shorter/Longer - Adjust email length
 * - Tone dropdown - Professional, Casual, Friendly, Formal
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Modal,
  TextInput,
  Pressable,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  AiBeautifyIcon,
  TextWrapIcon,
  ArrowShrink02Icon,
  ArrowExpand02Icon,
  SmileIcon,
} from '@hugeicons/core-free-icons';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useAiCompose, type ComposeTone } from '@/hooks/mutations/useAiCompose';

interface AiComposeToolbarProps {
  body: string;
  onBodyChange: (text: string) => void;
  onSubjectSuggested?: (subject: string) => void;
}

const TONE_OPTIONS: { value: ComposeTone; label: string; icon: string }[] = [
  { value: 'professional', label: 'Professional', icon: 'briefcase-outline' },
  { value: 'casual', label: 'Casual', icon: 'coffee-outline' },
  { value: 'friendly', label: 'Friendly', icon: 'emoticon-happy-outline' },
  { value: 'formal', label: 'Formal', icon: 'file-document-outline' },
];

export function AiComposeToolbar({ body, onBodyChange, onSubjectSuggested }: AiComposeToolbarProps) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const { draft, streamDraft, polish, changeTone, adjustLength, suggestSubject, isLoading } = useAiCompose();

  const [showDraftModal, setShowDraftModal] = useState(false);
  const [showToneMenu, setShowToneMenu] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [selectedTone, setSelectedTone] = useState<ComposeTone>('professional');

  const hasBody = body.trim().length > 0;

  // Handler for "Draft for me" button
  const handleDraft = useCallback(() => {
    setShowDraftModal(true);
    setDraftPrompt('');
  }, []);

  // Execute draft generation
  const executeDraft = useCallback(async () => {
    if (!draftPrompt.trim()) return;
    setShowDraftModal(false);

    try {
      // Use streaming for typewriter effect
      await streamDraft(draftPrompt, selectedTone, (text) => {
        onBodyChange(text);
      });
    } catch {
      // Error handled by hook
    }
  }, [draftPrompt, selectedTone, streamDraft, onBodyChange]);

  // Handler for "Polish" button
  const handlePolish = useCallback(async () => {
    if (!hasBody) return;
    try {
      const polished = await polish(body);
      onBodyChange(polished);
    } catch {
      // Error handled by hook
    }
  }, [body, hasBody, polish, onBodyChange]);

  // Handler for "Shorter" button
  const handleShorter = useCallback(async () => {
    if (!hasBody) return;
    try {
      const shorter = await adjustLength(body, 'shorter');
      onBodyChange(shorter);
    } catch {
      // Error handled by hook
    }
  }, [body, hasBody, adjustLength, onBodyChange]);

  // Handler for "Longer" button
  const handleLonger = useCallback(async () => {
    if (!hasBody) return;
    try {
      const longer = await adjustLength(body, 'longer');
      onBodyChange(longer);
    } catch {
      // Error handled by hook
    }
  }, [body, hasBody, adjustLength, onBodyChange]);

  // Handler for tone change
  const handleToneChange = useCallback(async (tone: ComposeTone) => {
    setShowToneMenu(false);
    setSelectedTone(tone);
    if (!hasBody) return;
    try {
      const rewritten = await changeTone(body, tone);
      onBodyChange(rewritten);
    } catch {
      // Error handled by hook
    }
  }, [body, hasBody, changeTone, onBodyChange]);

  // Handler for subject suggestion
  const handleSuggestSubject = useCallback(async () => {
    if (!hasBody || !onSubjectSuggested) return;
    try {
      const subject = await suggestSubject(body);
      onSubjectSuggested(subject);
    } catch {
      // Error handled by hook
    }
  }, [body, hasBody, suggestSubject, onSubjectSuggested]);

  const currentTone = TONE_OPTIONS.find((t) => t.value === selectedTone);

  return (
    <View style={[styles.container, { borderTopColor: colors.border }]}>
      <View style={styles.toolbar}>
        {/* Draft button */}
        <TouchableOpacity
          style={[styles.button, styles.primaryButton, { backgroundColor: colors.primary + '15' }]}
          onPress={handleDraft}
          disabled={isLoading}
          activeOpacity={0.7}
        >
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={AiBeautifyIcon as unknown as IconSvgElement} size={16} color={colors.primary} />
          ) : (
            <MaterialCommunityIcons name="creation" size={16} color={colors.primary} />
          )}
          <Text style={[styles.buttonText, { color: colors.primary }]}>Draft</Text>
        </TouchableOpacity>

        {/* Polish button */}
        <TouchableOpacity
          style={[styles.button, { borderColor: colors.border }, !hasBody && styles.buttonDisabled]}
          onPress={handlePolish}
          disabled={isLoading || !hasBody}
          activeOpacity={0.7}
        >
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={TextWrapIcon as unknown as IconSvgElement} size={16} color={hasBody ? colors.icon : colors.secondaryText} />
          ) : (
            <MaterialCommunityIcons name="auto-fix" size={16} color={hasBody ? colors.icon : colors.secondaryText} />
          )}
          <Text style={[styles.buttonText, { color: hasBody ? colors.text : colors.secondaryText }]}>Polish</Text>
        </TouchableOpacity>

        {/* Shorter button */}
        <TouchableOpacity
          style={[styles.button, { borderColor: colors.border }, !hasBody && styles.buttonDisabled]}
          onPress={handleShorter}
          disabled={isLoading || !hasBody}
          activeOpacity={0.7}
        >
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={ArrowShrink02Icon as unknown as IconSvgElement} size={16} color={hasBody ? colors.icon : colors.secondaryText} />
          ) : (
            <MaterialCommunityIcons name="arrow-collapse-vertical" size={16} color={hasBody ? colors.icon : colors.secondaryText} />
          )}
          <Text style={[styles.buttonText, { color: hasBody ? colors.text : colors.secondaryText }]}>Shorter</Text>
        </TouchableOpacity>

        {/* Tone dropdown */}
        <TouchableOpacity
          style={[styles.button, { borderColor: colors.border }]}
          onPress={() => setShowToneMenu(true)}
          disabled={isLoading}
          activeOpacity={0.7}
        >
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={SmileIcon as unknown as IconSvgElement} size={16} color={colors.icon} />
          ) : (
            <MaterialCommunityIcons name={currentTone?.icon as any || 'emoticon-outline'} size={16} color={colors.icon} />
          )}
          <Text style={[styles.buttonText, { color: colors.text }]}>{currentTone?.label || 'Tone'}</Text>
          <MaterialCommunityIcons name="chevron-down" size={14} color={colors.secondaryText} />
        </TouchableOpacity>

        {/* Loading indicator */}
        {isLoading && (
          <ActivityIndicator size="small" color={colors.primary} style={styles.loader} />
        )}
      </View>

      {/* Subject suggestion - only show when body exists and onSubjectSuggested is provided */}
      {hasBody && onSubjectSuggested && (
        <TouchableOpacity
          style={styles.subjectHint}
          onPress={handleSuggestSubject}
          disabled={isLoading}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="lightbulb-outline" size={14} color={colors.primary} />
          <Text style={[styles.subjectHintText, { color: colors.primary }]}>Suggest subject line</Text>
        </TouchableOpacity>
      )}

      {/* Draft prompt modal */}
      <Modal
        visible={showDraftModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDraftModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowDraftModal(false)}
        >
          <Pressable
            style={[styles.modalContent, { backgroundColor: colors.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHeader}>
              {Platform.OS === 'web' ? (
                <HugeiconsIcon icon={AiBeautifyIcon as unknown as IconSvgElement} size={20} color={colors.primary} />
              ) : (
                <MaterialCommunityIcons name="creation" size={20} color={colors.primary} />
              )}
              <Text style={[styles.modalTitle, { color: colors.text }]}>Draft with AI</Text>
            </View>

            <Text style={[styles.modalSubtitle, { color: colors.secondaryText }]}>
              Describe what you want to say, and Alia will draft it for you.
            </Text>

            <TextInput
              style={[
                styles.promptInput,
                { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
              ]}
              value={draftPrompt}
              onChangeText={setDraftPrompt}
              placeholder="e.g., Decline the meeting politely, suggest next week instead"
              placeholderTextColor={colors.searchPlaceholder}
              multiline
              autoFocus
            />

            <View style={styles.toneSelector}>
              <Text style={[styles.toneLabel, { color: colors.secondaryText }]}>Tone:</Text>
              <View style={styles.toneOptions}>
                {TONE_OPTIONS.map((tone) => (
                  <TouchableOpacity
                    key={tone.value}
                    style={[
                      styles.toneOption,
                      { borderColor: colors.border },
                      selectedTone === tone.value && { backgroundColor: colors.primary + '15', borderColor: colors.primary },
                    ]}
                    onPress={() => setSelectedTone(tone.value)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.toneOptionText,
                        { color: selectedTone === tone.value ? colors.primary : colors.text },
                      ]}
                    >
                      {tone.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, { borderColor: colors.border }]}
                onPress={() => setShowDraftModal(false)}
                activeOpacity={0.7}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.modalButtonPrimary,
                  { backgroundColor: colors.primary },
                  !draftPrompt.trim() && { opacity: 0.5 },
                ]}
                onPress={executeDraft}
                disabled={!draftPrompt.trim() || isLoading}
                activeOpacity={0.7}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={[styles.modalButtonText, { color: '#FFFFFF' }]}>Draft</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Tone menu modal */}
      <Modal
        visible={showToneMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowToneMenu(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowToneMenu(false)}
        >
          <Pressable
            style={[styles.toneMenuContent, { backgroundColor: colors.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.toneMenuTitle, { color: colors.text }]}>Change tone to...</Text>
            {TONE_OPTIONS.map((tone) => (
              <TouchableOpacity
                key={tone.value}
                style={[styles.toneMenuItem, selectedTone === tone.value && { backgroundColor: colors.primary + '10' }]}
                onPress={() => handleToneChange(tone.value)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={tone.icon as any}
                  size={20}
                  color={selectedTone === tone.value ? colors.primary : colors.icon}
                />
                <Text
                  style={[
                    styles.toneMenuItemText,
                    { color: selectedTone === tone.value ? colors.primary : colors.text },
                  ]}
                >
                  {tone.label}
                </Text>
                {selectedTone === tone.value && (
                  <MaterialCommunityIcons name="check" size={18} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  primaryButton: {
    borderWidth: 0,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '500',
  },
  loader: {
    marginLeft: 8,
  },
  subjectHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    paddingVertical: 4,
  },
  subjectHintText: {
    fontSize: 12,
    fontWeight: '500',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 20,
    ...Platform.select({
      web: { boxShadow: '0 4px 20px rgba(0,0,0,0.15)' } as any,
      default: { elevation: 8 },
    }),
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalSubtitle: {
    fontSize: 14,
    marginBottom: 16,
  },
  promptInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  toneSelector: {
    marginTop: 16,
  },
  toneLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
  },
  toneOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  toneOption: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  toneOptionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 20,
  },
  modalButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    minWidth: 80,
    alignItems: 'center',
  },
  modalButtonPrimary: {
    borderWidth: 0,
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Tone menu styles
  toneMenuContent: {
    width: '100%',
    maxWidth: 280,
    borderRadius: 12,
    paddingVertical: 8,
    ...Platform.select({
      web: { boxShadow: '0 4px 20px rgba(0,0,0,0.15)' } as any,
      default: { elevation: 8 },
    }),
  },
  toneMenuTitle: {
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  toneMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  toneMenuItemText: {
    fontSize: 15,
    flex: 1,
  },
});
