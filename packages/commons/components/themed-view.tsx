import { View, type ViewProps } from 'react-native';
import { useColors } from '@/hooks/useColors';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
};

export function ThemedView({ style, ...otherProps }: ThemedViewProps) {
  const { background } = useColors();
  return <View style={[{ backgroundColor: background }, style]} {...otherProps} />;
}
