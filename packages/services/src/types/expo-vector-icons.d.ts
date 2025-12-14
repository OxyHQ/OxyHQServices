declare module '@expo/vector-icons' {
  import type React from 'react';
  
  export const Ionicons: React.ComponentType<{
    name: string;
    size?: number;
    color?: string;
    style?: Record<string, unknown>;
    testID?: string;
  }>;
  
  export const MaterialCommunityIcons: React.ComponentType<{
    name: string;
    size?: number;
    color?: string;
    style?: Record<string, unknown>;
    testID?: string;
  }>;
}
