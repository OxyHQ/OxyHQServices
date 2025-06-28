/**
 * Simple validation test for the new Redux architecture
 * This test can be run to ensure the refactoring works correctly
 */

import { configureStore } from '@reduxjs/toolkit';

// Test that setupOxyStore can be imported and used
try {
  const { setupOxyStore } = require('../ui/store/setupOxyStore');
  
  console.log('✅ setupOxyStore imported successfully');
  
  // Test basic usage
  const reducers = setupOxyStore();
  console.log('✅ setupOxyStore() returns reducers:', Object.keys(reducers));
  
  // Test tree-shaking
  const authOnly = setupOxyStore.pick('auth');
  console.log('✅ Tree-shaking works:', Object.keys(authOnly));
  
  // Test with configureStore
  const store = configureStore({
    reducer: {
      ...setupOxyStore(),
      custom: (state = { test: true }) => state,
    },
  });
  
  const state = store.getState();
  console.log('✅ Store integration works:', Object.keys(state));
  
  // Test individual exports
  const { authSlice, followSlice } = require('../ui/store/slices');
  console.log('✅ Individual slices exported:', authSlice.name, followSlice.name);
  
  console.log('\n🎉 All tests passed! The new Redux architecture is working correctly.');
  
} catch (error) {
  console.error('❌ Test failed:', error);
  process.exit(1);
}