import React from 'react';
import { Platform, Text } from 'react-native';

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  style?: any;
}

// Icons wrapper that handles optional dependencies
let Ionicons: any;

try {
  const vectorIcons = require('@expo/vector-icons');
  Ionicons = vectorIcons.Ionicons;
} catch (e) {
  // Fallback component when @expo/vector-icons is not available
  Ionicons = ({ name, size = 24, color = '#000', ...props }: any) => (
    <Text style={{ fontSize: size, color, ...props.style }}>
      {getIconFallback(name)}
    </Text>
  );
}

function getIconFallback(name: string): string {
  const iconMap: { [key: string]: string } = {
    'person': '👤',
    'settings': '⚙️',
    'notifications': '🔔',
    'heart': '❤️',
    'home': '🏠',
    'search': '🔍',
    'add': '➕',
    'close': '✖️',
    'checkmark': '✓',
    'arrow-back': '←',
    'arrow-forward': '→',
    'star': '⭐',
    'eye': '👁️',
    'camera': '📷',
    'image': '🖼️',
    'mail': '📧',
    'lock': '🔒',
    'unlock': '🔓',
    'menu': '☰',
  };
  
  return iconMap[name] || '?';
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
export { Ionicons };
