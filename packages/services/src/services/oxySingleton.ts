import { OxyServices, OXY_API_URL } from '../core';
import { initializeOxyStore } from '../stores';

// Use the correct API base URL
const baseURL = OXY_API_URL;

// Create the singleton instance ONCE
const oxyServices = new OxyServices({ baseURL });

// Always initialize the store with the singleton
initializeOxyStore(oxyServices);

export default oxyServices; 