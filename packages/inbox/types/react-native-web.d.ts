/**
 * Augments react-native's style types with web-only properties supported by
 * react-native-web (transitions, outline, cursor, etc.). These are stripped
 * by the RN runtime on native platforms but are valid CSS on web.
 *
 * Keep this list minimal — only add what is actually used in the codebase.
 */

import 'react-native';

declare module 'react-native' {
  interface ViewStyle {
    transition?: string;
    outlineStyle?: 'none' | 'auto' | 'solid' | 'dashed' | 'dotted';
    cursor?: 'auto' | 'pointer' | 'default' | 'text' | 'grab' | 'grabbing' | 'not-allowed' | 'wait';
    boxShadow?: string;
  }
  interface TextStyle {
    transition?: string;
    userSelect?: 'auto' | 'none' | 'text' | 'all' | 'contain';
  }
}
