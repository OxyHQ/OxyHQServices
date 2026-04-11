/**
 * Cross-platform rich text editor.
 *
 * Web: contentEditable div with formatting toolbar.
 * Native: plain TextInput multiline fallback.
 */

import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export interface RichTextEditorProps {
  value: string;
  onChange: (content: string) => void;
  placeholder?: string;
  style?: object;
  autoFocus?: boolean;
}

/** Ref handle exposed via forwardRef for imperative control. */
export interface RichTextEditorHandle {
  /** Replace the entire editor content (HTML on web, plain text on native). */
  setContent: (content: string) => void;
  focus: () => void;
}

// ─── Web Implementation ──────────────────────────────────────────────

function WebRichTextEditor(
  { value, onChange, placeholder, style, autoFocus }: RichTextEditorProps,
  ref: React.Ref<RichTextEditorHandle>,
) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const isComposing = useRef(false);
  const lastValueRef = useRef(value);
  const [isEmpty, setIsEmpty] = useState(!value);

  // Track active formatting states
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());

  const updateActiveFormats = useCallback(() => {
    const formats = new Set<string>();
    if (document.queryCommandState('bold')) formats.add('bold');
    if (document.queryCommandState('italic')) formats.add('italic');
    if (document.queryCommandState('underline')) formats.add('underline');
    if (document.queryCommandState('strikeThrough')) formats.add('strikeThrough');
    if (document.queryCommandState('insertOrderedList')) formats.add('insertOrderedList');
    if (document.queryCommandState('insertUnorderedList')) formats.add('insertUnorderedList');
    setActiveFormats(formats);
  }, []);

  // Sync external value changes into the editor
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      el.innerHTML = value;
      setIsEmpty(!value);
    }
  }, [value]);

  // Auto-focus
  useEffect(() => {
    if (autoFocus && editorRef.current) {
      editorRef.current.focus();
    }
  }, [autoFocus]);

  // Expose imperative handle
  React.useImperativeHandle(ref, () => ({
    setContent(content: string) {
      const el = editorRef.current;
      if (!el) return;
      el.innerHTML = content;
      lastValueRef.current = content;
      setIsEmpty(!content);
      onChange(content);
    },
    focus() {
      editorRef.current?.focus();
    },
  }));

  const emitChange = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    // Treat <br> or empty tags as empty
    const textContent = el.textContent || '';
    const empty = !textContent.trim() && !html.includes('<img');
    setIsEmpty(empty);
    lastValueRef.current = empty ? '' : html;
    onChange(empty ? '' : html);
  }, [onChange]);

  const handleInput = useCallback(() => {
    if (isComposing.current) return;
    emitChange();
    updateActiveFormats();
  }, [emitChange, updateActiveFormats]);

  const handleCompositionStart = useCallback(() => {
    isComposing.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposing.current = false;
    emitChange();
  }, [emitChange]);

  // Plain-text paste by default; Shift+paste keeps formatting
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      // Check if Shift is held to allow rich paste (shiftKey exists on the native event)
      if ((e as unknown as KeyboardEvent).shiftKey) return;
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, text);
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'b') {
        e.preventDefault();
        document.execCommand('bold');
        updateActiveFormats();
      } else if (mod && e.key === 'i') {
        e.preventDefault();
        document.execCommand('italic');
        updateActiveFormats();
      } else if (mod && e.key === 'u') {
        e.preventDefault();
        document.execCommand('underline');
        updateActiveFormats();
      }
    },
    [updateActiveFormats],
  );

  const handleSelectionChange = useCallback(() => {
    updateActiveFormats();
  }, [updateActiveFormats]);

  // Attach native event listeners to the contentEditable div
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.addEventListener('input', handleInput);
    el.addEventListener('compositionstart', handleCompositionStart);
    el.addEventListener('compositionend', handleCompositionEnd);
    el.addEventListener('paste', handlePaste as EventListener);
    el.addEventListener('keydown', handleKeyDown as EventListener);
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      el.removeEventListener('input', handleInput);
      el.removeEventListener('compositionstart', handleCompositionStart);
      el.removeEventListener('compositionend', handleCompositionEnd);
      el.removeEventListener('paste', handlePaste as EventListener);
      el.removeEventListener('keydown', handleKeyDown as EventListener);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [handleInput, handleCompositionStart, handleCompositionEnd, handlePaste, handleKeyDown, handleSelectionChange]);

  // Toolbar commands
  const exec = useCallback(
    (command: string, argument?: string) => {
      editorRef.current?.focus();
      document.execCommand(command, false, argument);
      emitChange();
      updateActiveFormats();
    },
    [emitChange, updateActiveFormats],
  );

  const handleLink = useCallback(() => {
    const url = window.prompt('Enter URL:');
    if (url) exec('createLink', url);
  }, [exec]);

  const handleClearFormatting = useCallback(() => {
    exec('removeFormat');
    exec('unlink');
  }, [exec]);

  // Toolbar button component
  const ToolbarButton = useCallback(
    ({
      command,
      icon,
      label,
      onPress,
    }: {
      command?: string;
      icon?: string;
      label?: string;
      onPress?: () => void;
    }) => {
      const isActive = command ? activeFormats.has(command) : false;
      return (
        <TouchableOpacity
          onPress={onPress ?? (() => command && exec(command))}
          style={[
            webStyles.toolbarButton,
            isActive && { backgroundColor: `${colors.primary}20` },
          ]}
          activeOpacity={0.7}
        >
          {icon ? (
            <MaterialCommunityIcons
              name={icon as keyof typeof MaterialCommunityIcons.glyphMap}
              size={16}
              color={isActive ? colors.primary : colors.icon}
            />
          ) : label ? (
            <Text
              style={[
                webStyles.toolbarButtonLabel,
                { color: isActive ? colors.primary : colors.icon },
                label === 'B' && { fontWeight: '700' },
                label === 'I' && { fontStyle: 'italic' },
                label === 'U' && { textDecorationLine: 'underline' },
                label === 'S' && { textDecorationLine: 'line-through' },
              ]}
            >
              {label}
            </Text>
          ) : null}
        </TouchableOpacity>
      );
    },
    [activeFormats, colors, exec],
  );

  return (
    <View style={[webStyles.container, style]}>
      {/* Formatting toolbar */}
      <View
        style={[
          webStyles.toolbar,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <ToolbarButton command="bold" label="B" />
        <ToolbarButton command="italic" label="I" />
        <ToolbarButton command="underline" label="U" />
        <ToolbarButton command="strikeThrough" label="S" />
        <View
          style={[webStyles.toolbarSeparator, { backgroundColor: colors.border }]}
        />
        <ToolbarButton
          command="insertUnorderedList"
          icon="format-list-bulleted"
        />
        <ToolbarButton
          command="insertOrderedList"
          icon="format-list-numbered"
        />
        <View
          style={[webStyles.toolbarSeparator, { backgroundColor: colors.border }]}
        />
        <ToolbarButton icon="link-variant" onPress={handleLink} />
        <ToolbarButton icon="format-clear" onPress={handleClearFormatting} />
      </View>

      {/* Editable area */}
      <View style={webStyles.editorWrapper}>
        {isEmpty && placeholder && (
          <Text
            style={[webStyles.placeholder, { color: colors.searchPlaceholder }]}
            pointerEvents="none"
          >
            {placeholder}
          </Text>
        )}
        <div
          ref={(el) => {
            if (el && !editorRef.current) {
              editorRef.current = el;
              el.innerHTML = value;
              setIsEmpty(!value);
            }
          }}
          contentEditable
          suppressContentEditableWarning
          style={{
            flex: 1,
            minHeight: 200,
            padding: 16,
            fontSize: 15,
            lineHeight: '24px',
            color: colors.text,
            outline: 'none',
            fontFamily:
              "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            overflowY: 'auto' as const,
            wordBreak: 'break-word' as const,
          }}
        />
      </View>
    </View>
  );
}

const WebEditor = React.forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  WebRichTextEditor,
);

// ─── Native Implementation ───────────────────────────────────────────

function NativeRichTextEditor(
  { value, onChange, placeholder, style, autoFocus }: RichTextEditorProps,
  ref: React.Ref<RichTextEditorHandle>,
) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const inputRef = useRef<TextInput>(null);

  React.useImperativeHandle(ref, () => ({
    setContent(content: string) {
      onChange(content);
    },
    focus() {
      inputRef.current?.focus();
    },
  }));

  return (
    <TextInput
      ref={inputRef}
      style={[
        nativeStyles.bodyInput,
        { color: colors.text },
        style,
      ]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.searchPlaceholder}
      multiline
      textAlignVertical="top"
      autoFocus={autoFocus}
    />
  );
}

const NativeEditor = React.forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  NativeRichTextEditor,
);

// ─── Exported component (platform switch) ────────────────────────────

export const RichTextEditor = React.forwardRef<
  RichTextEditorHandle,
  RichTextEditorProps
>((props, ref) => {
  if (Platform.OS === 'web') {
    return <WebEditor ref={ref} {...props} />;
  }
  return <NativeEditor ref={ref} {...props} />;
});

RichTextEditor.displayName = 'RichTextEditor';

// ─── Helper: strip HTML to plain text ────────────────────────────────

export function stripHtml(html: string): string {
  if (Platform.OS === 'web') {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }
  // Naive fallback for native
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ─── Styles ──────────────────────────────────────────────────────────

const webStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  toolbarButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  },
  toolbarButtonLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  toolbarSeparator: {
    width: 1,
    height: 16,
    marginHorizontal: 4,
  },
  editorWrapper: {
    flex: 1,
    position: 'relative',
  },
  placeholder: {
    position: 'absolute',
    top: 16,
    left: 16,
    fontSize: 15,
    pointerEvents: 'none',
  },
});

const nativeStyles = StyleSheet.create({
  bodyInput: {
    flex: 1,
    fontSize: 15,
    lineHeight: 24,
    padding: 16,
    minHeight: 200,
  },
});
