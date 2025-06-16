import { Platform } from 'react-native';

// Toast and Toaster implementations with fallbacks
let toast: any;
let Toaster: any;

try {
  if (Platform.OS === 'web') {
    // Use sonner for web
    const sonner = require('sonner');
    toast = sonner.toast;
    Toaster = sonner.Toaster;
  } else {
    // Use sonner-native for React Native
    const sonnerNative = require('sonner-native');
    toast = sonnerNative.toast;
    Toaster = sonnerNative.Toaster;
  }
} catch (e) {
  // Fallback implementations when sonner packages are not available
  toast = {
    success: (message: string) => console.log('✅ Success:', message),
    error: (message: string) => console.error('❌ Error:', message),
    warning: (message: string) => console.warn('⚠️ Warning:', message),
    info: (message: string) => console.info('ℹ️ Info:', message),
    loading: (message: string) => console.log('⏳ Loading:', message),
    message: (message: string) => console.log('💬 Message:', message),
  };
  
  // Fallback Toaster component (no-op for React Native, minimal for web)
  const React = require('react');
  Toaster = () => React.createElement('div', { style: { display: 'none' } });
}

export { toast, Toaster };