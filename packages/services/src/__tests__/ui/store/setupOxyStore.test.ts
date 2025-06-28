import { configureStore } from '@reduxjs/toolkit';
import { setupOxyStore, oxyReducers } from '../../../ui/store/setupOxyStore';
import { authSlice, followSlice } from '../../../ui/store/slices';

describe('setupOxyStore', () => {
  test('should return all Oxy reducers', () => {
    const reducers = setupOxyStore();
    
    expect(reducers).toHaveProperty('auth');
    expect(reducers).toHaveProperty('follow');
    expect(reducers.auth).toBe(authSlice.reducer);
    expect(reducers.follow).toBe(followSlice.reducer);
  });

  test('should work with configureStore', () => {
    const store = configureStore({
      reducer: {
        ...setupOxyStore(),
        customReducer: (state = { test: true }) => state,
      },
    });

    const state = store.getState();
    expect(state).toHaveProperty('auth');
    expect(state).toHaveProperty('follow');
    expect(state).toHaveProperty('customReducer');
    expect(state.customReducer.test).toBe(true);
  });

  test('should support tree-shaking with pick method', () => {
    const authOnly = setupOxyStore.pick('auth');
    expect(authOnly).toHaveProperty('auth');
    expect(authOnly).not.toHaveProperty('follow');

    const followOnly = setupOxyStore.pick('follow');
    expect(followOnly).toHaveProperty('follow');
    expect(followOnly).not.toHaveProperty('auth');

    const both = setupOxyStore.pick('auth', 'follow');
    expect(both).toHaveProperty('auth');
    expect(both).toHaveProperty('follow');
  });

  test('should export individual reducers', () => {
    expect(oxyReducers).toHaveProperty('auth');
    expect(oxyReducers).toHaveProperty('follow');
    expect(oxyReducers.auth).toBe(authSlice.reducer);
    expect(oxyReducers.follow).toBe(followSlice.reducer);
  });
});