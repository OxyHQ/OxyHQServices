/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

const tintColorLight = '#d169e5';
const tintColorDark = '#d169e5';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
    // Extended icon colors for components
    card: '#F2F2F7',
    border: '#E5E5EA',
    secondaryText: '#8E8E93',
    iconHome: '#1A73E8',
    iconPrimary: '#1A73E8',
    iconPersonalInfo: '#34A853',
    iconSuccess: '#34A853',
    iconSecurity: '#4285F4',
    iconData: '#9C27B0',
    iconSharing: '#EA4335',
    iconPayments: '#FBBC04',
    iconStorage: '#FF9800',
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
    // Extended icon colors for components
    card: '#1C1C1E',
    border: '#2C2C2E',
    secondaryText: '#8E8E93',
    iconHome: '#8AB4F8',
    iconPrimary: '#8AB4F8',
    iconPersonalInfo: '#81C995',
    iconSuccess: '#81C995',
    iconSecurity: '#8AB4F8',
    iconData: '#CE93D8',
    iconSharing: '#F28B82',
    iconPayments: '#FDD663',
    iconStorage: '#FFB74D',
  },
};
