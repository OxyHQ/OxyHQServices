/**
 * Lightweight stub for `react-native-safe-area-context` in the commons Jest env.
 */
export const SafeAreaProvider = ({ children }: { children?: React.ReactNode }) => children;
export const SafeAreaView = ({ children }: { children?: React.ReactNode }) => children;

export function useSafeAreaInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function useSafeAreaFrame() {
  return { x: 0, y: 0, width: 390, height: 844 };
}
