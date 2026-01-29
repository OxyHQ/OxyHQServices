/**
 * Sonner Toast - Native Implementation
 *
 * This file is resolved by React Native bundlers (Metro)
 * Only imports 'sonner-native', not 'sonner'
 */
import * as NativeSonner from 'sonner-native';

// Define proper types for the toast components
interface ToastFunction {
  (message: string, options?: Record<string, unknown>): void;
  success: (message: string, options?: Record<string, unknown>) => void;
  error: (message: string, options?: Record<string, unknown>) => void;
  info: (message: string, options?: Record<string, unknown>) => void;
  warning: (message: string, options?: Record<string, unknown>) => void;
  loading: (message: string, options?: Record<string, unknown>) => void;
}

type ToasterComponent = (props?: Record<string, unknown>) => React.ReactElement | null;

const { toast: nativeToast, Toaster: NativeToaster } = NativeSonner as {
  toast: ToastFunction;
  Toaster: ToasterComponent;
};

export const toast = nativeToast;
export const Toaster = NativeToaster;
export type ToastT = typeof nativeToast;
