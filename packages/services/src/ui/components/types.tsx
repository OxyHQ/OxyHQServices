// Types for react-native-paper compatibility
// Support both string theme ('light' | 'dark') and InternalTheme object
export type ThemeProp = Partial<InternalTheme> | 'light' | 'dark';

export type MD3Elevation = 0 | 1 | 2 | 3 | 4 | 5;

export type InternalTheme = {
  version: 3;
  isV3: true;
  dark: boolean;
  mode?: 'adaptive' | 'exact';
  roundness: number;
  animation: {
    scale: number;
    defaultAnimationDuration?: number;
  };
  colors: {
    primary: string;
    primaryContainer: string;
    secondary: string;
    secondaryContainer: string;
    tertiary: string;
    tertiaryContainer: string;
    surface: string;
    surfaceVariant: string;
    surfaceDisabled: string;
    background: string;
    error: string;
    errorContainer: string;
    onPrimary: string;
    onPrimaryContainer: string;
    onSecondary: string;
    onSecondaryContainer: string;
    onTertiary: string;
    onTertiaryContainer: string;
    onSurface: string;
    onSurfaceVariant: string;
    onSurfaceDisabled: string;
    onError: string;
    onErrorContainer: string;
    onBackground: string;
    outline: string;
    outlineVariant: string;
    inverseSurface: string;
    inverseOnSurface: string;
    inversePrimary: string;
    shadow: string;
    scrim: string;
    backdrop: string;
    elevation: {
      level0: string;
      level1: string;
      level2: string;
      level3: string;
      level4: string;
      level5: string;
    };
  };
  fonts: {
    displayLarge: any;
    displayMedium: any;
    displaySmall: any;
    headlineLarge: any;
    headlineMedium: any;
    headlineSmall: any;
    titleLarge: any;
    titleMedium: any;
    titleSmall: any;
    labelLarge: any;
    labelMedium: any;
    labelSmall: any;
    bodyLarge: any;
    bodyMedium: any;
    bodySmall: any;
    default: any;
  };
};

export type $Omit<T, K> = Pick<T, Exclude<keyof T, K>>;
export type $RemoveChildren<T extends React.ComponentType<any>> = $Omit<
  React.ComponentPropsWithoutRef<T>,
  'children'
>;

