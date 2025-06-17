/**
 * Test file to verify FormData polyfill functionality
 */

import { getFormDataConstructor } from '../utils/polyfills';

describe('FormData Polyfill Tests', () => {
  it('should provide FormData constructor', () => {
    const FormDataConstructor = getFormDataConstructor();
    expect(FormDataConstructor).toBeDefined();
    expect(typeof FormDataConstructor).toBe('function');
  });

  it('should create FormData instance successfully', () => {
    const FormDataConstructor = getFormDataConstructor();
    const formData = new FormDataConstructor();
    expect(formData).toBeDefined();
    expect(typeof formData.append).toBe('function');
  });

  it('should handle form data append operations', () => {
    const FormDataConstructor = getFormDataConstructor();
    const formData = new FormDataConstructor();
    
    // Should not throw
    expect(() => {
      formData.append('test', 'value');
    }).not.toThrow();
  });
});
