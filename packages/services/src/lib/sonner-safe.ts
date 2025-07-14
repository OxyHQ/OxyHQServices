/**
 * Safe sonner export that works in both frontend and backend
 * In frontend: exports the actual toast function
 * In backend: exports a no-op function
 */

let toast: any;

// Environment detection
const isFrontend = typeof window !== 'undefined' || 
                   (typeof global !== 'undefined' && global.navigator) ||
                   (typeof process !== 'undefined' && process.env.NODE_ENV === 'development' && typeof document !== 'undefined');

if (isFrontend) {
  try {
    // Try to import the actual sonner
    const sonnerModule = require('./sonner');
    toast = sonnerModule.toast;
  } catch (e) {
    // Fallback to no-op if import fails
    toast = () => {};
  }
} else {
  // Backend environment - no-op function
  toast = () => {};
}

export { toast }; 