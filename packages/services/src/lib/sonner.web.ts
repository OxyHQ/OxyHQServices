/**
 * Sonner Toast - Web Implementation
 *
 * This file is resolved by web bundlers (Vite, Webpack, etc.)
 * Only imports 'sonner' (web version), not 'sonner-native'
 */
import * as WebSonner from 'sonner';

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

const { toast: webToast, Toaster: WebToaster } = WebSonner as {
  toast: ToastFunction;
  Toaster: ToasterComponent;
};

export const toast = webToast;
export const Toaster = WebToaster;
export type ToastT = typeof webToast;
