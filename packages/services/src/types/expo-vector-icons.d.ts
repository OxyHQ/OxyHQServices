declare module '@expo/vector-icons' {
  export const Ionicons: {
    [key: string]: React.ComponentType<{
      name: string;
      size?: number;
      color?: string;
      style?: Record<string, unknown>;
    }>;
  };
}
