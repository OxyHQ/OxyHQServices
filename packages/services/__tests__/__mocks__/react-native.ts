/**
 * Lightweight React Native stub for the services jest environment (jsdom).
 *
 * Mirrors the shape used at runtime closely enough that hooks under test
 * which only touch `Platform.OS`, `Platform.select`, `Dimensions`, and
 * `StyleSheet.create` keep working without dragging the full RN runtime
 * into the test bundle.
 */

type PlatformOS = 'ios' | 'android' | 'web' | 'windows' | 'macos';

export const Platform: {
  OS: PlatformOS;
  select: <T>(obj: Partial<Record<PlatformOS | 'default' | 'native', T>>) => T | undefined;
  Version: number;
} = {
  OS: 'web',
  select: (obj) => {
    const os = Platform.OS;
    if (os in obj) return obj[os];
    if (os !== 'web' && 'native' in obj) return obj.native;
    return obj.default;
  },
  Version: 17,
};

export const Dimensions = {
  get: () => ({ width: 375, height: 667, scale: 1, fontScale: 1 }),
  addEventListener: () => ({ remove: () => undefined }),
};

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: <T>(style: T): T => style,
  hairlineWidth: 1,
  absoluteFillObject: {},
};

export const Appearance = {
  getColorScheme: () => 'light',
  addChangeListener: () => ({ remove: () => undefined }),
};
