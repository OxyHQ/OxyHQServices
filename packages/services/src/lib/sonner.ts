import { Platform } from 'react-native';
import * as WebSonner from 'sonner';
import * as NativeSonner from 'sonner-native';

const { toast: webToast, Toaster: WebToaster } = WebSonner as any;
const { toast: nativeToast, Toaster: NativeToaster } = NativeSonner as any;

export const toast = Platform.OS === 'web' ? webToast : nativeToast;
export const Toaster = Platform.OS === 'web' ? WebToaster : NativeToaster;
export type ToastT = typeof webToast;
