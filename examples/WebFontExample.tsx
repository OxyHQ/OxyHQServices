import React from 'react';
import { AppRegistry } from 'react-native';
import { OxyProvider, setupFonts } from '@oxyhq/services';
import App from './App'; // Your main app component

// Call setupFonts before rendering to setup web fonts
setupFonts();

// Main entry point for the application
const RootComponent = () => (
    <OxyProvider
        oxyServices={/* your oxyServices instance */}
        contextOnly={false}
        theme="light"
    >
        <App />
    </OxyProvider>
);

// Register the app
AppRegistry.registerComponent('OxyApp', () => RootComponent);

// For web, we also need to register the browser renderer
if (typeof document !== 'undefined') {
    const rootTag = document.getElementById('root');
    AppRegistry.runApplication('OxyApp', { rootTag });
}
