import type React from 'react';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  style?: any;
}

const OxyIcon: React.FC<IconProps> = ({ 
  name, 
  size = 24, 
  color = '#000', 
  style 
}) => {
  // Handle both string and Ionicons name types
  const iconName = name as any;
  
  return (
    <Ionicons
      name={iconName}
      size={size}
      color={color}
      style={style}
    />
  );
};

export default OxyIcon;
