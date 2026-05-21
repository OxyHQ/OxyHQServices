declare module '@expo/vector-icons' {
  import type React from 'react';
  import type { StyleProp, TextStyle, ImageStyle } from 'react-native';

  type IconStyleProp = StyleProp<TextStyle> | StyleProp<ImageStyle>;

  export const Ionicons: React.ComponentType<{
    name: string;
    size?: number;
    color?: string;
    style?: IconStyleProp;
    testID?: string;
  }>;

  export const MaterialCommunityIcons: React.ComponentType<{
    name: string;
    size?: number;
    color?: string;
    style?: IconStyleProp;
    testID?: string;
  }>;
}
