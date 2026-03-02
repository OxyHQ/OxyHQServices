/**
 * Ask Alia - Draggable bottom sheet chat interface for inbox questions.
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
  StyleSheet,
  Platform,
  Modal,
  Pressable,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useKeyboardHandler } from 'react-native-keyboard-controller';
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Cancel01Icon, SentIcon } from '@hugeicons/core-free-icons';

import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { streamAliaChatCompletion } from '@/services/aliaApi';
import type { Message } from '@/services/emailApi';
import { AliaFace, type AliaExpression } from './AliaFace';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AskAliaProps {
  messages: Message[];
  onNavigateToMessage?: (messageId: string) => void;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const SPRING_CONFIG = {
  damping: 25,
  stiffness: 300,
  mass: 0.8,
};

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

const SUGGESTIONS = [
  { text: 'What emails need my attention?', icon: 'alert-circle-outline' as const },
  { text: 'Summarize emails from today', icon: 'text-box-outline' as const },
  { text: 'Did anyone reply to my last email?', icon: 'reply-outline' as const },
  { text: 'Find emails with attachments', icon: 'attachment' as const },
];

function buildEmailContext(messages: Message[]): string {
  if (messages.length === 0) return 'No emails available.';

  const recent = messages.slice(0, 20);
  return recent.map((msg, i) => {
    const from = msg.from.name || msg.from.address;
    const date = new Date(msg.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const preview = (msg.text || '').slice(0, 300);
    return `[Email ${i + 1}] From: ${from} | Date: ${date} | Subject: ${msg.subject}\n${preview}`;
  }).join('\n\n---\n\n');
}

export function AskAlia({ messages, onNavigateToMessage }: AskAliaProps) {
  const { oxyServices } = useOxy();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  // Chat state
  const [input, setInput] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // Sheet visibility
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);
  const hasClosedRef = useRef(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reanimated shared values for bottom sheet
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const backdropOpacity = useSharedValue(0);
  const scrollOffsetY = useSharedValue(0);
  const allowPanClose = useSharedValue(true);
  const keyboardHeight = useSharedValue(0);
  const panContext = useSharedValue({ y: 0 });

  // Scroll ref for auto-scroll
  const scrollRef = useRef<Animated.ScrollView>(null);

  // Keyboard tracking
  useKeyboardHandler({
    onMove: (e) => {
      'worklet';
      keyboardHeight.value = e.height;
    },
    onEnd: (e) => {
      'worklet';
      keyboardHeight.value = e.height;
    },
  }, []);

  // Alia face expression based on state
  const faceExpression: AliaExpression = useMemo(() => {
    if (isStreaming) return 'Thinking';
    if (chat.length === 0) return 'Greeting';
    return 'Idle A';
  }, [isStreaming, chat.length]);

  // Present / dismiss
  const finishDismiss = useCallback(() => {
    if (hasClosedRef.current) return;
    hasClosedRef.current = true;
    setRendered(false);
    setVisible(false);
  }, []);

  const handlePresent = useCallback(() => {
    hasClosedRef.current = false;
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setRendered(true);
    setVisible(true);
    backdropOpacity.value = withTiming(1, { duration: 250 });
    translateY.value = withSpring(0, SPRING_CONFIG);
  }, []);

  const handleDismiss = useCallback(() => {
    backdropOpacity.value = withTiming(0, { duration: 250 }, (finished) => {
      if (finished) runOnJS(finishDismiss)();
    });
    translateY.value = withSpring(SCREEN_HEIGHT, { ...SPRING_CONFIG, stiffness: 250 });

    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => {
      finishDismiss();
      closeTimeoutRef.current = null;
    }, 350);
  }, [finishDismiss]);

  useEffect(() => () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  // Chat logic
  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput('');
    setChat((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsStreaming(true);
    setChat((prev) => [...prev, { role: 'assistant', content: '' }]);

    const emailContext = buildEmailContext(messages);

    try {
      const token = oxyServices.httpService.getAccessToken();
      if (!token) throw new Error('Not authenticated');

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
        token,
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
    } catch {
      setChat((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === 'assistant') {
          updated[lastIdx] = { ...updated[lastIdx], content: "I'm having trouble connecting right now. Please try again." };
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, messages, chat, oxyServices]);

  const handleClear = useCallback(() => setChat([]), []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      setTimeout(() => (scrollRef.current as any)?.scrollToEnd?.({ animated: true }), 100);
    }
  }, [chat]);

  // Gesture coordination
  const nativeGesture = useMemo(() => Gesture.Native(), []);

  const panGesture = Gesture.Pan()
    .simultaneousWithExternalGesture(nativeGesture)
    .onStart(() => {
      'worklet';
      panContext.value = { y: translateY.value };
      allowPanClose.value = scrollOffsetY.value <= 8;
    })
    .onUpdate((event) => {
      'worklet';
      if (!allowPanClose.value) return;
      if (event.translationY > 0 && scrollOffsetY.value > 8) return;
      const newY = panContext.value.y + event.translationY;
      translateY.value = Math.max(0, newY);
    })
    .onEnd((event) => {
      'worklet';
      if (!allowPanClose.value) return;
      const velocity = event.velocityY;
      const distance = translateY.value;
      const closeThreshold = Math.max(140, SCREEN_HEIGHT * 0.25);
      const shouldClose = velocity > 900 || (distance > closeThreshold && velocity > -300);

      if (shouldClose) {
        translateY.value = withSpring(SCREEN_HEIGHT, { ...SPRING_CONFIG, velocity });
        backdropOpacity.value = withTiming(0, { duration: 250 }, (finished) => {
          if (finished) runOnJS(finishDismiss)();
        });
      } else {
        translateY.value = withSpring(0, { ...SPRING_CONFIG, velocity });
      }
    });

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollOffsetY.value = event.contentOffset.y;
    },
  });

  // Animated styles
  const backdropAnimStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const sheetAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value - keyboardHeight.value }],
  }));

  const sheetMaxHeightStyle = useAnimatedStyle(() => ({
    maxHeight: SCREEN_HEIGHT - keyboardHeight.value - insets.top,
  }), [insets.top]);

  return (
    <>
      {/* FAB - Alia Face */}
      <View style={styles.fab}>
        <TouchableOpacity
          style={styles.fabTouchable}
          onPress={handlePresent}
          activeOpacity={0.8}
        >
          <AliaFace size={52} expression="Idle A" />
        </TouchableOpacity>
      </View>

      {/* Bottom Sheet */}
      {rendered && (
        <Modal visible={rendered} transparent animationType="none" statusBarTranslucent onRequestClose={handleDismiss}>
          <GestureHandlerRootView style={StyleSheet.absoluteFill}>
            {/* Backdrop */}
            <Animated.View style={[styles.backdrop, backdropAnimStyle]}>
              <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} />
            </Animated.View>

            {/* Sheet */}
            <GestureDetector gesture={panGesture}>
              <Animated.View
                style={[
                  styles.sheet,
                  { backgroundColor: colors.background },
                  sheetAnimStyle,
                  sheetMaxHeightStyle,
                ]}
              >
                {/* Drag Handle */}
                <View style={styles.dragHandle}>
                  <View style={[styles.dragHandlePill, { backgroundColor: isDark ? '#444' : '#C7C7CC' }]} />
                </View>

                {/* Header */}
                <View style={styles.sheetHeader}>
                  <View style={styles.headerLeft}>
                    <AliaFace size={28} expression={faceExpression} />
                    <Text style={[styles.headerTitle, { color: colors.text }]}>Alia</Text>
                  </View>
                  <View style={styles.headerRight}>
                    {chat.length > 0 && (
                      <TouchableOpacity onPress={handleClear} style={styles.clearButton}>
                        <Text style={[styles.clearText, { color: colors.secondaryText }]}>Clear</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={handleDismiss} style={styles.closeButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      {Platform.OS === 'web' ? (
                        <HugeiconsIcon icon={Cancel01Icon as unknown as IconSvgElement} size={20} color={colors.icon} />
                      ) : (
                        <MaterialCommunityIcons name="close" size={20} color={colors.icon} />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Chat Area */}
                <GestureDetector gesture={nativeGesture}>
                  <Animated.ScrollView
                    ref={scrollRef}
                    style={styles.chatArea}
                    contentContainerStyle={styles.chatContent}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    onScroll={scrollHandler}
                    scrollEventThrottle={16}
                  >
                    {chat.length === 0 ? (
                      /* Welcome Screen */
                      <View style={styles.welcome}>
                        <Text style={[styles.greeting, { color: colors.primary }]}>
                          How can I help you today?
                        </Text>
                        <View style={styles.suggestions}>
                          {SUGGESTIONS.map((s, i) => (
                            <TouchableOpacity
                              key={i}
                              style={[styles.suggestionRow, { backgroundColor: isDark ? colors.surfaceVariant : colors.surface }]}
                              onPress={() => setInput(s.text)}
                              activeOpacity={0.7}
                            >
                              <MaterialCommunityIcons name={s.icon} size={20} color={colors.primary} />
                              <Text style={[styles.suggestionText, { color: colors.text }]}>{s.text}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    ) : (
                      /* Messages */
                      chat.map((msg, i) => {
                        const isUser = msg.role === 'user';
                        const isFirstAssistantInGroup = !isUser && (i === 0 || chat[i - 1]?.role === 'user');
                        const isStreamingThis = isStreaming && i === chat.length - 1 && !isUser;

                        if (isUser) {
                          return (
                            <View key={i} style={styles.userMessage}>
                              <View style={[styles.userBubble, { borderColor: colors.border }]}>
                                <BlurView intensity={60} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
                                <Text style={[styles.userText, { color: colors.text }]}>{msg.content}</Text>
                              </View>
                            </View>
                          );
                        }

                        return (
                          <View key={i} style={styles.assistantMessage}>
                            {isFirstAssistantInGroup && (
                              <View style={styles.assistantAvatar}>
                                <AliaFace size={22} expression={isStreamingThis ? 'Thinking' : 'Idle A'} />
                              </View>
                            )}
                            <Text style={[styles.assistantText, { color: colors.text }]}>
                              {msg.content || (isStreamingThis ? '\u2758' : '')}
                            </Text>
                          </View>
                        );
                      })
                    )}
                  </Animated.ScrollView>
                </GestureDetector>

                {/* Input Bar */}
                <View style={[styles.inputContainer, { borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
                  <TextInput
                    style={[styles.input, { color: colors.text, backgroundColor: isDark ? colors.surfaceVariant : colors.surface }]}
                    value={input}
                    onChangeText={setInput}
                    placeholder="Enter a prompt here"
                    placeholderTextColor={colors.secondaryText}
                    multiline
                    maxLength={500}
                    onSubmitEditing={handleSend}
                    blurOnSubmit={false}
                  />
                  <TouchableOpacity
                    style={[styles.sendButton, { backgroundColor: colors.primary }, (!input.trim() || isStreaming) && { opacity: 0.4 }]}
                    onPress={handleSend}
                    disabled={!input.trim() || isStreaming}
                    activeOpacity={0.7}
                  >
                    {isStreaming ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : Platform.OS === 'web' ? (
                      <HugeiconsIcon icon={SentIcon as unknown as IconSvgElement} size={18} color="#FFFFFF" />
                    ) : (
                      <MaterialCommunityIcons name="arrow-up" size={20} color="#FFFFFF" />
                    )}
                  </TouchableOpacity>
                </View>
              </Animated.View>
            </GestureDetector>
          </GestureHandlerRootView>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  // FAB
  fab: {
    position: 'absolute',
    bottom: 80,
    right: 16,
    zIndex: 100,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.2)' } as any,
      default: { elevation: 8 },
    }),
    borderRadius: 28,
  },
  fabTouchable: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Backdrop
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },

  // Sheet
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    maxWidth: 600,
    alignSelf: 'center',
    ...Platform.select({
      web: { marginHorizontal: 'auto', boxShadow: '0 -4px 24px rgba(0,0,0,0.15)' } as any,
      default: { elevation: 16 },
    }),
  },

  // Drag handle
  dragHandle: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  dragHandlePill: {
    width: 36,
    height: 5,
    borderRadius: 3,
  },

  // Header
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  clearButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  clearText: {
    fontSize: 14,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },

  // Chat area
  chatArea: {
    flex: 1,
  },
  chatContent: {
    padding: 16,
    paddingTop: 4,
    flexGrow: 1,
  },

  // Welcome
  welcome: {
    paddingTop: 16,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 32,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  suggestions: {
    gap: 8,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
  },
  suggestionText: {
    fontSize: 14,
    flex: 1,
  },

  // User messages — frosted glass bubble
  userMessage: {
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  userBubble: {
    maxWidth: '85%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  userText: {
    fontSize: 15,
    lineHeight: 22,
  },

  // Assistant messages — raw text, no bubble
  assistantMessage: {
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  assistantAvatar: {
    marginBottom: 6,
  },
  assistantText: {
    fontSize: 15,
    lineHeight: 24,
  },

  // Input
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
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
