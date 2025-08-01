import { Platform } from 'react-native';
import * as WebSonner from 'sonner';
import * as NativeSonner from 'sonner-native';

// Define proper types for the toast components
interface ToastFunction {
  (message: string, options?: Record<string, unknown>): void;
  success: (message: string, options?: Record<string, unknown>) => void;
  error: (message: string, options?: Record<string, unknown>) => void;
  info: (message: string, options?: Record<string, unknown>) => void;
  warning: (message: string, options?: Record<string, unknown>) => void;
}

type ToasterComponent = (props?: Record<string, unknown>) => React.ReactElement | null;

const { toast: webToast, Toaster: WebToaster } = WebSonner as { 
  toast: ToastFunction; 
  Toaster: ToasterComponent; 
};
const { toast: nativeToast, Toaster: NativeToaster } = NativeSonner as { 
  toast: ToastFunction; 
  Toaster: ToasterComponent; 
};

export const toast = Platform.OS === 'web' ? webToast : nativeToast;
export const Toaster = Platform.OS === 'web' ? WebToaster : NativeToaster;
export type ToastT = typeof webToast;
