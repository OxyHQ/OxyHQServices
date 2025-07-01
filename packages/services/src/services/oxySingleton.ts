import { OxyServices, OXY_API_URL } from '../core';
import { initializeOxyStore, useOxyStore } from '../stores';

// Use the correct API base URL
const baseURL = OXY_API_URL;

// Create the singleton instance ONCE
const oxyServices = new OxyServices({ baseURL });

// Initialize store once hydration is finished to ensure tokens are available
useOxyStore.persist.onFinishHydration(() => {
  initializeOxyStore(oxyServices);
});

// Also run initialization immediately in case hydration already occurred
initializeOxyStore(oxyServices);

export default oxyServices;
