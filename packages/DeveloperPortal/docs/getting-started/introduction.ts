import { DocPage } from '../config';

const baseURL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export const introduction: DocPage = {
  id: 'introduction',
  title: 'Introduction',
  description: 'Welcome to the Oxy Developer Portal',
  category: 'getting-started',
  icon: 'book-outline',
  iconColor: '#007AFF',
  content: {
    introduction: 'The Oxy ecosystem provides a comprehensive suite of APIs and services for building powerful integrations. This includes the Oxy API, OxyHQServices client library, and ecosystem apps like Mention and Homiio.',
    sections: [
      {
        id: 'overview',
        title: 'What You Can Build',
        content: 'The Oxy platform enables you to build authentication systems, social features, file management, real-time notifications, payment processing, and more. All APIs are RESTful and return JSON-encoded responses.',
      },
      {
        id: 'components',
        title: 'Platform Components',
        content: 'The Oxy platform consists of three main components:',
        note: 'Oxy API - Backend REST API with authentication, user management, and services\n\nOxyHQServices - TypeScript/React Native client library with UI components\n\nEcosystem Apps - Mention (social network), Homiio (home management), and more',
      },
      {
        id: 'base-url',
        title: 'Base URL',
        content: 'All API requests should be made to:',
        code: baseURL,
        language: 'text',
      },
      {
        id: 'rate-limits',
        title: 'Rate Limits',
        content: 'API requests are rate limited to prevent abuse. Current limits: 100 requests per 15 minutes per IP address. Login attempts are limited to 10 per 10 minutes.',
        tip: 'Contact support if you need higher rate limits for your application.',
      },
    ],
  },
};
