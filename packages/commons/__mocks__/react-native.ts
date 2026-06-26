/**
 * Minimal React Native stub for the accounts test environment.
 *
 * Only the surfaces used by code under test are stubbed. We expose a mutable
 * `Platform.OS` so individual tests can flip between `web` / `ios` / `android`
 * to exercise platform-conditional branches.
 */

type PlatformOS = 'ios' | 'android' | 'web' | 'windows' | 'macos';

export const Platform: {
  OS: PlatformOS;
  select: <T>(obj: Partial<Record<PlatformOS | 'default' | 'native', T>>) => T | undefined;
  Version: number;
} = {
  OS: 'ios',
  select: (obj) => {
    const os = Platform.OS;
    if (os in obj) return obj[os];
    if (os !== 'web' && 'native' in obj) return obj.native;
    return obj.default;
  },
  Version: 17,
};

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: <T>(style: T): T => style,
  hairlineWidth: 1,
};

export const Dimensions = {
  get: () => ({ width: 375, height: 812 }),
  addEventListener: () => ({ remove: () => undefined }),
};

export const useColorScheme = (): 'light' | 'dark' => 'light';

export const I18nManager: {
  isRTL: boolean;
  allowRTL: (allowRTL: boolean) => void;
  forceRTL: (forceRTL: boolean) => void;
  getConstants: () => { isRTL: boolean; doLeftAndRightSwapInRTL: boolean };
} = {
  isRTL: false,
  allowRTL: () => undefined,
  forceRTL: () => undefined,
  getConstants: () => ({ isRTL: false, doLeftAndRightSwapInRTL: true }),
};
