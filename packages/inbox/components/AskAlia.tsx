/**
 * Ask Alia - Floating chat interface for inbox questions.
 *
 * Users can ask natural language questions about their inbox:
 * - "What did Mike say about the deadline?"
 * - "Show me emails from last week about the project"
 * - "Did anyone reply to my budget proposal?"
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Modal,
  Pressable,
  Animated,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { AiChat02Icon, Cancel01Icon, MailSend01Icon } from '@hugeicons/core-free-icons';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { streamAliaChatCompletion } from '@/services/aliaApi';
import type { Message } from '@/services/emailApi';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AskAliaProps {
  messages: Message[];
  onNavigateToMessage?: (messageId: string) => void;
}

const ALIA_SYSTEM_PROMPT = `You are Alia, a helpful AI email assistant. The user is asking questions about their inbox.

You have access to their recent emails (provided below). Answer their questions based on this context.

Guidelines:
- Be concise and helpful
- Reference specific emails when relevant (include sender name and date)
- If you can't find relevant information, say so
- Suggest related searches if helpful
- Use a friendly, professional tone
- If asked to perform actions (like drafting), explain you can help with that in the compose window

When referencing emails, format like: "In the email from [Sender] on [Date]..."`;

function buildEmailContext(messages: Message[]): string {
  if (messages.length === 0) {
    return 'No emails available.';
  }

  // Take most recent 20 emails for context
  const recent = messages.slice(0, 20);

  return recent.map((msg, i) => {
    const from = msg.from.name || msg.from.address;
    const date = new Date(msg.date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    const preview = (msg.text || '').slice(0, 300);
    return `[Email ${i + 1}] From: ${from} | Date: ${date} | Subject: ${msg.subject}\n${preview}`;
  }).join('\n\n---\n\n');
}

export function AskAlia({ messages, onNavigateToMessage }: AskAliaProps) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isDark = colorScheme === 'dark';

  const [visible, setVisible] = useState(false);
  const [input, setInput] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for the floating button
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );

    // Only pulse if chat is empty (to attract attention)
    if (chat.length === 0 && !visible) {
      pulse.start();
    } else {
      pulse.stop();
      pulseAnim.setValue(1);
    }

    return () => pulse.stop();
  }, [chat.length, visible, pulseAnim]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput('');
    setChat((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsStreaming(true);

    // Add empty assistant message that we'll stream into
    setChat((prev) => [...prev, { role: 'assistant', content: '' }]);

    const emailContext = buildEmailContext(messages);

    try {
      const generator = streamAliaChatCompletion({
        model: 'alia-lite',
        messages: [
          {
            role: 'system',
            content: `${ALIA_SYSTEM_PROMPT}\n\n## User's Recent Emails:\n${emailContext}`,
          },
          ...chat.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: userMessage },
        ],
        maxTokens: 500,
        temperature: 0.7,
      });

      for await (const chunk of generator) {
        setChat((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === 'assistant') {
            updated[lastIdx] = { ...updated[lastIdx], content: chunk };
          }
          return updated;
        });
      }
    } catch (err) {
      setChat((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === 'assistant') {
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: "I'm having trouble connecting right now. Please try again.",
          };
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, messages, chat]);

  const handleClear = useCallback(() => {
    setChat([]);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [chat]);

  return (
    <>
      {/* Floating Action Button */}
      <Animated.View
        style={[
          styles.fab,
          {
            backgroundColor: colors.primary,
            transform: [{ scale: pulseAnim }],
          },
        ]}
      >
        <TouchableOpacity
          style={styles.fabTouchable}
          onPress={() => setVisible(true)}
          activeOpacity={0.8}
        >
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={AiChat02Icon as unknown as IconSvgElement} size={24} color="#FFFFFF" />
          ) : (
            <MaterialCommunityIcons name="robot-happy-outline" size={24} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      </Animated.View>

      {/* Chat Modal */}
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalContainer}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setVisible(false)} />

          <View style={[styles.chatContainer, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.chatHeader, { borderBottomColor: colors.border }]}>
              <View style={styles.chatHeaderLeft}>
                {Platform.OS === 'web' ? (
                  <HugeiconsIcon icon={AiChat02Icon as unknown as IconSvgElement} size={22} color={colors.primary} />
                ) : (
                  <MaterialCommunityIcons name="robot-happy-outline" size={22} color={colors.primary} />
                )}
                <Text style={[styles.chatTitle, { color: colors.text }]}>Ask Alia</Text>
              </View>
              <View style={styles.chatHeaderRight}>
                {chat.length > 0 && (
                  <TouchableOpacity onPress={handleClear} style={styles.clearButton}>
                    <Text style={[styles.clearButtonText, { color: colors.secondaryText }]}>Clear</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setVisible(false)} style={styles.closeButton}>
                  {Platform.OS === 'web' ? (
                    <HugeiconsIcon icon={Cancel01Icon as unknown as IconSvgElement} size={22} color={colors.icon} />
                  ) : (
                    <MaterialCommunityIcons name="close" size={22} color={colors.icon} />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Chat Messages */}
            <ScrollView
              ref={scrollRef}
              style={styles.chatMessages}
              contentContainerStyle={styles.chatMessagesContent}
              showsVerticalScrollIndicator={false}
            >
              {chat.length === 0 ? (
                <View style={styles.welcomeContainer}>
                  <View style={[styles.welcomeIcon, { backgroundColor: colors.primary + '15' }]}>
                    {Platform.OS === 'web' ? (
                      <HugeiconsIcon icon={AiChat02Icon as unknown as IconSvgElement} size={32} color={colors.primary} />
                    ) : (
                      <MaterialCommunityIcons name="robot-happy-outline" size={32} color={colors.primary} />
                    )}
                  </View>
                  <Text style={[styles.welcomeTitle, { color: colors.text }]}>Hi, I'm Alia!</Text>
                  <Text style={[styles.welcomeSubtitle, { color: colors.secondaryText }]}>
                    Ask me anything about your inbox
                  </Text>
                  <View style={styles.suggestions}>
                    {[
                      'What emails need my attention?',
                      'Did anyone reply to my last email?',
                      'Summarize emails from today',
                    ].map((suggestion, i) => (
                      <TouchableOpacity
                        key={i}
                        style={[styles.suggestion, { borderColor: colors.border }]}
                        onPress={() => setInput(suggestion)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.suggestionText, { color: colors.text }]}>{suggestion}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : (
                chat.map((msg, i) => (
                  <View
                    key={i}
                    style={[
                      styles.message,
                      msg.role === 'user' ? styles.userMessage : styles.assistantMessage,
                      {
                        backgroundColor: msg.role === 'user'
                          ? colors.primary
                          : isDark ? colors.surfaceVariant : colors.surface,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.messageText,
                        { color: msg.role === 'user' ? '#FFFFFF' : colors.text },
                      ]}
                    >
                      {msg.content || (isStreaming && i === chat.length - 1 ? '...' : '')}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>

            {/* Input */}
            <View style={[styles.inputContainer, { borderTopColor: colors.border }]}>
              <TextInput
                style={[
                  styles.input,
                  { color: colors.text, backgroundColor: isDark ? colors.surfaceVariant : colors.surface },
                ]}
                value={input}
                onChangeText={setInput}
                placeholder="Ask about your emails..."
                placeholderTextColor={colors.searchPlaceholder}
                multiline
                maxLength={500}
                onSubmitEditing={handleSend}
                blurOnSubmit={false}
              />
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  { backgroundColor: colors.primary },
                  (!input.trim() || isStreaming) && { opacity: 0.5 },
                ]}
                onPress={handleSend}
                disabled={!input.trim() || isStreaming}
                activeOpacity={0.7}
              >
                {isStreaming ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : Platform.OS === 'web' ? (
                  <HugeiconsIcon icon={MailSend01Icon as unknown as IconSvgElement} size={18} color="#FFFFFF" />
                ) : (
                  <MaterialCommunityIcons name="send" size={18} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 80,
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    zIndex: 100,
    ...Platform.select({
      web: { boxShadow: '0 4px 12px rgba(0,0,0,0.25)' } as any,
      default: { elevation: 8 },
    }),
  },
  fabTouchable: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  chatContainer: {
    height: '70%',
    maxHeight: 600,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chatHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  clearButtonText: {
    fontSize: 14,
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  chatMessages: {
    flex: 1,
  },
  chatMessagesContent: {
    padding: 16,
  },
  welcomeContainer: {
    alignItems: 'center',
    paddingTop: 40,
  },
  welcomeIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  welcomeTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  welcomeSubtitle: {
    fontSize: 14,
    marginBottom: 24,
  },
  suggestions: {
    width: '100%',
    gap: 8,
  },
  suggestion: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  suggestionText: {
    fontSize: 14,
  },
  message: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    marginBottom: 8,
  },
  userMessage: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
