import { DocPage } from '../config';

const baseURL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export const quickStart: DocPage = {
  id: 'quick-start',
  title: 'Quick Start',
  description: 'Get started with the Oxy API in 5 minutes',
  category: 'getting-started',
  icon: 'rocket-outline',
  iconColor: '#FF9500',
  subItems: [
    { id: 'quick-start#create-app', title: 'Create an App', description: 'Set up your application' },
    { id: 'quick-start#get-credentials', title: 'Get Credentials', description: 'Retrieve your API keys' },
    { id: 'quick-start#first-request', title: 'First Request', description: 'Make your first API call' },
  ],
  content: {
    introduction: 'This quick start guide will help you make your first API request in just a few minutes.',
    sections: [
      {
        id: 'create-app',
        title: '1. Create an Application',
        content: 'Navigate to the Apps tab in the Developer Portal and click "Create New App". Give your app a meaningful name and description.',
        tip: 'Choose a name that describes your integration purpose. You can always change it later.',
      },
      {
        id: 'get-credentials',
        title: '2. Get Your Credentials',
        content: 'After creating your app, you\'ll receive two important credentials:',
        code: `App ID: app_xxxxxxxxxxxxx
App Secret: sk_xxxxxxxxxxxxx`,
        language: 'text',
        warning: 'Store your App Secret securely. It will only be shown once. If you lose it, you\'ll need to regenerate it.',
      },
      {
        id: 'first-request',
        title: '3. Make Your First Request',
        content: 'Use your App ID to authenticate your first API request:',
        code: `const appId = 'your_app_id_here';

fetch('${baseURL}/api/users/me', {
  method: 'GET',
  headers: {
    'Authorization': \`Bearer \${appId}\`,
    'Content-Type': 'application/json'
  }
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));`,
        language: 'javascript',
      },
    ],
  },
};
