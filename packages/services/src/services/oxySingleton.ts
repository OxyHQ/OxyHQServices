import { OxyServices, OXY_API_URL } from '../core';
import { initializeOxyStore, useOxyStore } from '../stores';

// Use the correct API base URL
const baseURL = OXY_API_URL;

// Create the singleton instance ONCE
const oxyServices = new OxyServices({ baseURL });

// Initialize the store only after persisted state has been rehydrated
if (useOxyStore.persist.hasHydrated()) {
  initializeOxyStore(oxyServices);
} else {
  useOxyStore.persist.onFinishHydration(() => {
    initializeOxyStore(oxyServices);
  });
}

export default oxyServices; 