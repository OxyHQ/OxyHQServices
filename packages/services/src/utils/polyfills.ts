/**
 * Polyfills for React Native environments that may be missing certain Web APIs
 */

// FormData polyfill for React Native/Hermes environments
if (typeof FormData === 'undefined') {
  try {
    const FormDataPolyfill = require('form-data');
    // Use globalThis which is more universal than global
    if (typeof globalThis !== 'undefined') {
      (globalThis as any).FormData = FormDataPolyfill;
    }
  } catch (error) {
    console.warn('form-data package not found. File uploads may not work in React Native environments without native FormData support.');
  }
}

// Export a helper to ensure FormData is available
export const ensureFormDataAvailable = (): boolean => {
  return typeof FormData !== 'undefined' || typeof require !== 'undefined';
};

// Get FormData constructor (either native or polyfilled)
export const getFormDataConstructor = (): any => {
  if (typeof FormData !== 'undefined') {
    return FormData;
  }
  
  try {
    return require('form-data');
  } catch (error) {
    throw new Error('FormData is not available and form-data package is not installed. Please install form-data for file upload support.');
  }
};
