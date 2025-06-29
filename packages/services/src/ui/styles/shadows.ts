import { Platform } from 'react-native';

/**
 * Cross-platform shadow utility that eliminates "shadow*" deprecation warnings
 */
export interface ShadowConfig {
  shadowColor?: string;
  shadowOffset?: { width: number; height: number };
  shadowOpacity?: number;
  shadowRadius?: number;
  elevation?: number;
}

/**
 * Creates cross-platform shadow styles
 * Uses boxShadow for web and native shadow props for iOS/Android
 */
export function createShadow(config: ShadowConfig) {
  const {
    shadowColor = '#000',
    shadowOffset = { width: 0, height: 2 },
    shadowOpacity = 0.1,
    shadowRadius = 4,
    elevation = 2,
  } = config;

  return Platform.select({
    web: {
      boxShadow: `${shadowOffset.width}px ${shadowOffset.height}px ${shadowRadius}px rgba(${hexToRgb(shadowColor)}, ${shadowOpacity})`,
    },
    ios: {
      shadowColor,
      shadowOffset,
      shadowOpacity,
      shadowRadius,
    },
    android: {
      elevation,
    },
    default: {
      shadowColor,
      shadowOffset,
      shadowOpacity,
      shadowRadius,
      elevation,
    },
  });
}

/**
 * Helper function to convert hex color to RGB
 */
function hexToRgb(hex: string): string {
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Handle shorthand hex colors (e.g., #fff)
  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('');
  }
  
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  return `${r}, ${g}, ${b}`;
}

/**
 * Predefined shadow presets
 */
export const shadows = {
  small: createShadow({
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  }),
  
  medium: createShadow({
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  }),
  
  large: createShadow({
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  }),
  
  card: createShadow({
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  }),
  
  button: createShadow({
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  }),
}; 