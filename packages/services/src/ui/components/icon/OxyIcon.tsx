import type React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@oxyhq/bloom/theme';

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  style?: Record<string, unknown>;
}

const OxyIcon: React.FC<IconProps> = ({
  name,
  size = 24,
  color,
  style
}) => {
  const theme = useTheme();
  const resolvedColor = color ?? theme.colors.icon;

  return (
    <Ionicons
      name={name as React.ComponentProps<typeof Ionicons>['name']}
      size={size}
      color={resolvedColor}
      style={style}
    />
  );
};

export default OxyIcon;
