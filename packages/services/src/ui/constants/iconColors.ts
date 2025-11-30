/**
 * Icon color helpers and semantic mappings
 * Provides easy access to icon colors from the theme system
 */

import { Colors } from './theme';

/**
 * Get icon colors for a specific theme
 */
export const getIconColors = (theme: 'light' | 'dark') => {
  return Colors[theme];
};

/**
 * Semantic icon color mappings
 * Maps common icon types to their appropriate theme colors
 */
export const IconColorMap = {
  // Profile and personal information
  profile: 'iconPersonalInfo',
  personalInfo: 'iconPersonalInfo',
  editProfile: 'iconPersonalInfo',
  
  // Security and authentication
  security: 'iconSecurity',
  password: 'iconSecurity',
  lock: 'iconSecurity',
  shield: 'iconSecurity',
  
  // Documents and rules
  document: 'iconSecurity',
  rules: 'iconSecurity',
  file: 'iconSecurity',
  
  // Premium and special features
  premium: 'iconPayments',
  star: 'iconPayments',
  leaderboard: 'iconPayments',
  trophy: 'iconPayments',
  
  // Rewards and gifts
  rewards: 'iconPayments',
  gift: 'iconStorage',
  
  // Notifications and warnings
  notifications: 'iconStorage',
  warning: 'iconStorage',
  bell: 'iconStorage',
  
  // Help and FAQ
  help: 'iconPersonalInfo',
  faq: 'iconPersonalInfo',
  question: 'iconPersonalInfo',
  
  // Data and privacy
  data: 'iconData',
  privacy: 'iconData',
  settings: 'iconData',
  
  // Sharing and social
  sharing: 'iconSharing',
  social: 'iconSharing',
  
  // Primary actions
  primary: 'iconPrimary',
  home: 'iconHome',
} as const;

/**
 * Get icon color by semantic name
 */
export const getIconColor = (
  semanticName: keyof typeof IconColorMap,
  theme: 'light' | 'dark' = 'light'
): string => {
  const colorKey = IconColorMap[semanticName];
  const colors = getIconColors(theme);
  return colors[colorKey as keyof typeof colors] as string;
};

/**
 * Helper to get icon color for common use cases
 */
export const useIconColor = (semanticName: keyof typeof IconColorMap, theme: 'light' | 'dark') => {
  return getIconColor(semanticName, theme);
};

