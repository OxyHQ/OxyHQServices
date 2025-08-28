import type React from 'react';
import { Platform, type StyleProp, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  style?: Record<string, unknown>;
}

const OxyIcon: React.FC<IconProps> = ({
  name,
  size = 24,
  color = '#000',
  style
}) => {
  // Icon name is already properly typed as IoniconsGlyphs

  return (
    <Ionicons
      name={name as any}
      size={size}
      color={color}
      style={style}
    />
  );
};

export default OxyIcon;
