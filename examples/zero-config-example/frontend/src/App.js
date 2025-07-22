import React from 'react';
import { OxyZeroConfigProvider } from '@oxyhq/services/ui';
import Dashboard from './Dashboard';

/**
 * Zero-Config OxyHQ Services Example App
 * 
 * This demonstrates the simplest possible setup:
 * 1. Wrap your app with OxyZeroConfigProvider (this file)
 * 2. Use useOxyZeroConfig() hook in any component (Dashboard.js)
 * 
 * That's it! No configuration needed.
 */
function App() {
  return (
    <OxyZeroConfigProvider
      apiUrl="http://localhost:3001" // Your Oxy API URL
      onAuthChange={(user) => {
        console.log('Authentication state changed:', user ? `Logged in as ${user.username}` : 'Logged out');
      }}
    >
      <div style={{ 
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '20px'
      }}>
        <Dashboard />
      </div>
    </OxyZeroConfigProvider>
  );
}

export default App;