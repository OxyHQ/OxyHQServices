import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#202124',
    background: '#FFFFFF',
    surface: '#F8F9FA',
    surfaceVariant: '#F1F3F4',
    tint: '#1A73E8',
    icon: '#5F6368',
    border: '#DADCE0',
    secondaryText: '#5F6368',
    // Gmail-style colors
    primary: '#1A73E8',
    primaryContainer: '#D2E3FC',
    error: '#D93025',
    unread: '#202124',
    read: '#5F6368',
    starred: '#F4B400',
    // Mailbox sidebar
    sidebarBackground: '#FFFFFF',
    sidebarItemActive: '#D2E3FC',
    sidebarItemActiveText: '#1967D2',
    sidebarText: '#202124',
    // Compose
    composeFab: '#C2E7FF',
    composeFabText: '#001D35',
    composeFabIcon: '#001D35',
    // Search
    searchBackground: '#EAF1FB',
    searchText: '#202124',
    searchPlaceholder: '#5F6368',
    // Avatar
    avatarColors: ['#1A73E8', '#34A853', '#EA4335', '#FBBC04', '#9334E6', '#E8710A'],
    // Semantic
    danger: '#D93025',
    success: '#1E8E3E',
    warning: '#F9AB00',
    // Swipe
    swipeArchive: '#1E8E3E',
    swipeDelete: '#D93025',
    selectedRow: '#E8F0FE',
  },
  dark: {
    text: '#E8EAED',
    background: '#000000',
    surface: '#1F1F1F',
    surfaceVariant: '#2D2D2D',
    tint: '#8AB4F8',
    icon: '#9AA0A6',
    border: '#3C4043',
    secondaryText: '#9AA0A6',
    primary: '#8AB4F8',
    primaryContainer: '#004A77',
    error: '#F28B82',
    unread: '#E8EAED',
    read: '#9AA0A6',
    starred: '#FDD663',
    sidebarBackground: '#1F1F1F',
    sidebarItemActive: '#004A77',
    sidebarItemActiveText: '#8AB4F8',
    sidebarText: '#E8EAED',
    composeFab: '#004A77',
    composeFabText: '#C2E7FF',
    composeFabIcon: '#C2E7FF',
    searchBackground: '#303134',
    searchText: '#E8EAED',
    searchPlaceholder: '#9AA0A6',
    avatarColors: ['#8AB4F8', '#81C995', '#F28B82', '#FDD663', '#C58AF9', '#FCAD70'],
    danger: '#F28B82',
    success: '#81C995',
    warning: '#FDD663',
    swipeArchive: '#81C995',
    swipeDelete: '#F28B82',
    selectedRow: '#1A3A5C',
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
