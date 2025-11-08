import { ScrollView, StyleSheet, View, TouchableOpacity, Linking, Platform, TextInput, useWindowDimensions } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/user-avatar';
import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';

interface DocContent {
  introduction: string;
  sections: Array<{
    id: string;
    title: string;
    content: string;
    code?: string;
    language?: string;
    note?: string;
    warning?: string;
    tip?: string;
  }>;
}

interface DocPage {
  id: string;
  title: string;
  description: string;
  category: string;
  content: DocContent;
}

// External docs for ecosystem apps
interface ExternalDoc {
  id: string;
  title: string;
  description: string;
  category: string;
  url: string;
  icon?: string;
}

const externalDocs: ExternalDoc[] = [
  {
    id: 'mention',
    title: 'Mention Social Network',
    description: 'Build integrations with Mention, the Oxy ecosystem social network',
    category: 'Ecosystem Apps',
    url: 'https://mention.earth/docs',
    icon: 'people',
  },
  {
    id: 'homiio',
    title: 'Homiio',
    description: 'Integrate with Homiio, the home management platform',
    category: 'Ecosystem Apps',
    url: 'https://homiio.com/docs',
    icon: 'home',
  },
];

const docPages: DocPage[] = [
  {
    id: 'introduction',
    title: 'Introduction',
    description: 'Welcome to the Oxy Developer Portal',
    category: 'Getting Started',
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
          code: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001',
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
  },
  {
    id: 'quick-start',
    title: 'Quick Start',
    description: 'Get started with the Oxy API in 5 minutes',
    category: 'Getting Started',
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

fetch('${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001'}/api/users/me', {
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
  },
  {
    id: 'authentication',
    title: 'Authentication',
    description: 'Learn how to authenticate your API requests',
    category: 'API Basics',
    content: {
      introduction: 'All API requests must be authenticated using your application credentials. The Oxy API uses Bearer token authentication.',
      sections: [
        {
          id: 'bearer-auth',
          title: 'Bearer Token Authentication',
          content: 'Include your App ID in the Authorization header of every request:',
          code: `Authorization: Bearer YOUR_APP_ID`,
          language: 'text',
        },
        {
          id: 'example-auth',
          title: 'Example with cURL',
          content: 'Here\'s how to make an authenticated request using cURL:',
          code: `curl -X GET "${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001'}/api/users/me" \\
  -H "Authorization: Bearer YOUR_APP_ID" \\
  -H "Content-Type: application/json"`,
          language: 'bash',
        },
        {
          id: 'example-js',
          title: 'Example with JavaScript',
          content: 'And here\'s the same request using JavaScript fetch:',
          code: `const response = await fetch('${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001'}/api/users/me', {
  headers: {
    'Authorization': 'Bearer YOUR_APP_ID',
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
console.log(data);`,
          language: 'javascript',
        },
        {
          id: 'security',
          title: 'Security Best Practices',
          content: 'Always keep your credentials secure:',
          warning: 'Never expose your App Secret in client-side code or commit it to version control.',
          tip: 'Use environment variables to store your credentials and rotate them regularly.',
        },
      ],
    },
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    description: 'Receive real-time event notifications',
    category: 'API Basics',
    content: {
      introduction: 'Webhooks allow your application to receive real-time notifications when events occur in your Oxy account.',
      sections: [
        {
          id: 'setup',
          title: 'Setting Up Webhooks',
          content: 'To receive webhook events, configure a webhook URL in your app settings. This URL will receive POST requests when events occur.',
        },
        {
          id: 'payload',
          title: 'Webhook Payload',
          content: 'Each webhook request contains a JSON payload with event information:',
          code: `{
  "event": "user.created",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "id": "user_123",
    "email": "user@example.com",
    "name": "John Doe"
  }
}`,
          language: 'json',
        },
        {
          id: 'verify',
          title: 'Verifying Webhook Signatures',
          content: 'Always verify that webhook requests come from Oxy by checking the signature:',
          code: `const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(payload).digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}

// In your webhook handler
app.post('/webhooks', (req, res) => {
  const signature = req.headers['x-oxy-signature'];
  const payload = JSON.stringify(req.body);
  
  if (!verifyWebhookSignature(payload, signature, process.env.APP_SECRET)) {
    return res.status(401).send('Invalid signature');
  }
  
  // Process the webhook
  console.log('Event:', req.body.event);
  res.status(200).send('OK');
});`,
          language: 'javascript',
          warning: 'Always verify webhook signatures to prevent malicious requests.',
        },
        {
          id: 'events',
          title: 'Available Events',
          content: 'The following webhook events are available:',
          note: 'user.created, user.updated, user.deleted, file.uploaded, file.deleted, payment.completed, payment.failed',
        },
      ],
    },
  },
  {
    id: 'errors',
    title: 'Error Handling',
    description: 'Understanding API errors and status codes',
    category: 'API Basics',
    content: {
      introduction: 'The Oxy API uses conventional HTTP response codes to indicate success or failure of requests.',
      sections: [
        {
          id: 'status-codes',
          title: 'HTTP Status Codes',
          content: 'Common status codes you may encounter:',
          code: `200 - OK: Request succeeded
201 - Created: Resource created successfully
400 - Bad Request: Invalid request parameters
401 - Unauthorized: Invalid or missing authentication
403 - Forbidden: Authenticated but not authorized
404 - Not Found: Resource does not exist
429 - Too Many Requests: Rate limit exceeded
500 - Internal Server Error: Something went wrong`,
          language: 'text',
        },
        {
          id: 'error-format',
          title: 'Error Response Format',
          content: 'Error responses include a JSON body with details:',
          code: `{
  "error": {
    "code": "invalid_request",
    "message": "Missing required parameter: email",
    "param": "email"
  }
}`,
          language: 'json',
        },
        {
          id: 'handling',
          title: 'Handling Errors',
          content: 'Always check the response status and handle errors appropriately:',
          code: `try {
  const response = await fetch('${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001'}/api/endpoint', {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${appId}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ data })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error.message);
  }
  
  const data = await response.json();
  return data;
} catch (error) {
  console.error('API Error:', error.message);
  // Handle error appropriately
}`,
          language: 'javascript',
        },
      ],
    },
  },
  {
    id: 'api-endpoints',
    title: 'API Endpoints Reference',
    description: 'Complete reference of all Oxy API endpoints',
    category: 'API Reference',
    content: {
      introduction: 'The Oxy API provides comprehensive endpoints for authentication, user management, social features, file storage, payments, and more.',
      sections: [
        {
          id: 'auth-endpoints',
          title: 'Authentication Endpoints',
          content: 'All authentication and account management endpoints:',
          code: `POST /api/auth/signup - Register new user
POST /api/auth/login - Login with credentials
POST /api/auth/totp/verify-login - Verify TOTP after password
POST /api/auth/refresh - Refresh access token
POST /api/auth/logout - Logout user
GET  /api/auth/validate - Validate current token

POST /api/auth/recover/request - Request account recovery
POST /api/auth/recover/verify - Verify recovery code
POST /api/auth/recover/reset - Reset password with code
POST /api/auth/recover/totp/reset - Reset with TOTP
POST /api/auth/recover/backup/reset - Reset with backup code

POST /api/auth/totp/enroll/start - Start TOTP enrollment
POST /api/auth/totp/enroll/verify - Verify TOTP enrollment
POST /api/auth/totp/disable - Disable TOTP

GET  /api/auth/check-username/:username - Check availability
GET  /api/auth/check-email/:email - Check availability`,
          language: 'text',
          tip: 'Login attempts are rate-limited to 10 per 10 minutes per IP.',
        },
        {
          id: 'user-endpoints',
          title: 'User Management Endpoints',
          content: 'User profile and management endpoints:',
          code: `GET  /api/users/me - Get current user
PUT  /api/users/me - Update current user
GET  /api/users/:userId - Get user by ID
PUT  /api/users/:userId - Update user (admin)

GET  /api/users/:userId/followers - Get user followers
GET  /api/users/:userId/following - Get user following
POST /api/users/:userId/follow - Follow user
POST /api/users/:userId/unfollow - Unfollow user
GET  /api/users/:userId/follow-status - Check follow status

GET  /api/users/:userId/sessions - Get user sessions
DELETE /api/users/:userId/sessions/:sessionId - Delete session`,
          language: 'text',
        },
        {
          id: 'file-endpoints',
          title: 'File Management Endpoints',
          content: 'Upload, download, and manage files with GridFS storage:',
          code: `POST /api/files/upload-raw - Upload file (multipart/form-data)
GET  /api/files/:id - Stream/download file
GET  /api/files/meta/:id - Get file metadata
GET  /api/files/list/:userID - List user files
DELETE /api/files/:id - Delete file`,
          language: 'text',
          warning: 'Maximum file size is 50MB. Files are stored in GridFS and streamed efficiently.',
        },
        {
          id: 'profile-endpoints',
          title: 'Profile & Social Endpoints',
          content: 'Search and discover users:',
          code: `GET  /api/profiles/username/:username - Get profile by username
GET  /api/profiles/search?q=query - Search profiles
GET  /api/profiles/recommendations - Get recommended profiles`,
          language: 'text',
        },
        {
          id: 'notification-endpoints',
          title: 'Notification Endpoints',
          content: 'Manage real-time notifications:',
          code: `GET  /api/notifications - Get user notifications
GET  /api/notifications/unread-count - Get unread count
PUT  /api/notifications/:id/read - Mark as read
PUT  /api/notifications/read-all - Mark all as read
DELETE /api/notifications/:id - Delete notification`,
          language: 'text',
          note: 'Notifications are also sent via Socket.IO for real-time updates.',
        },
        {
          id: 'payment-endpoints',
          title: 'Payment & Wallet Endpoints',
          content: 'Process payments and manage digital wallets:',
          code: `POST /api/payments/process - Process payment
POST /api/payments/validate - Validate payment method
GET  /api/payments/methods/:userId - Get payment methods

GET  /api/wallet/:userId - Get wallet info
GET  /api/wallet/transactions/:userId - Transaction history
POST /api/wallet/transfer - Transfer funds
POST /api/wallet/purchase - Process purchase
POST /api/wallet/withdraw - Request withdrawal`,
          language: 'text',
        },
        {
          id: 'karma-endpoints',
          title: 'Karma System Endpoints',
          content: 'Reputation and karma management:',
          code: `GET  /api/karma/:userId - Get user karma
POST /api/karma/:userId - Give karma
GET  /api/karma/:userId/total - Get karma total
GET  /api/karma/:userId/history - Get karma history
GET  /api/karma/leaderboard - Get karma leaderboard
GET  /api/karma/rules - Get karma rules`,
          language: 'text',
        },
        {
          id: 'analytics-endpoints',
          title: 'Analytics Endpoints (Premium)',
          content: 'Advanced analytics and insights:',
          code: `GET  /api/analytics - Get analytics data
POST /api/analytics/update - Update analytics
GET  /api/analytics/viewers - Get content viewers
GET  /api/analytics/followers - Get follower details`,
          language: 'text',
          warning: 'Analytics endpoints require premium access.',
        },
      ],
    },
  },
  {
    id: 'oxyhq-services',
    title: 'OxyHQServices Client Library',
    description: 'TypeScript/React Native client library for Oxy API',
    category: 'Client Libraries',
    content: {
      introduction: 'OxyHQServices (@oxyhq/services) is a comprehensive TypeScript client library providing zero-config authentication, automatic token management, and UI components for React Native, Expo, and Node.js applications.',
      sections: [
        {
          id: 'installation',
          title: 'Installation',
          content: 'Install the package via npm:',
          code: `npm install @oxyhq/services`,
          language: 'bash',
          note: 'For React Native/Expo projects, add this as the first line of your entry file:\nimport "react-native-url-polyfill/auto";',
        },
        {
          id: 'react-native-setup',
          title: 'React Native Setup',
          content: 'Wrap your app with OxyProvider and use the useOxy hook:',
          code: `import { OxyProvider, useOxy } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}

function UserProfile() {
  const { user, isAuthenticated, login, logout } = useOxy();
  
  if (!isAuthenticated) {
    return <Text>Please sign in</Text>;
  }
  
  return <Text>Welcome, {user?.name}!</Text>;
}`,
          language: 'typescript',
          tip: 'The useOxy hook provides access to authentication state, user data, and service methods.',
        },
        {
          id: 'backend-setup',
          title: 'Backend (Node.js) Setup',
          content: 'Use the pre-configured client or create a custom instance:',
          code: `import { oxyClient } from '@oxyhq/services/core';

// Use pre-configured client
const session = await oxyClient.signIn('username', 'password');
const user = await oxyClient.getCurrentUser();

// Or create custom instance
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({ 
  baseURL: process.env.OXY_API_URL 
});`,
          language: 'typescript',
        },
        {
          id: 'core-methods',
          title: 'Core Methods',
          content: 'Essential methods for authentication and user management:',
          code: `// Authentication
await oxyClient.signIn(username, password);
await oxyClient.signUp(username, email, password);
await oxyClient.logout();

// User Management
const user = await oxyClient.getCurrentUser();
const userById = await oxyClient.getUserById('user123');
const profile = await oxyClient.getProfileByUsername('john_doe');
await oxyClient.updateProfile({ name: 'John Doe' });

// Social Features
await oxyClient.followUser('user123');
await oxyClient.unfollowUser('user123');
const followers = await oxyClient.getUserFollowers('user123');
const following = await oxyClient.getUserFollowing('user123');`,
          language: 'typescript',
        },
        {
          id: 'ui-components',
          title: 'UI Components',
          content: 'Pre-built React Native components:',
          code: `import { 
  OxySignInButton,
  Avatar,
  FollowButton,
  OxyLogo 
} from '@oxyhq/services';

function MyComponent() {
  const { showBottomSheet } = useOxy();
  
  return (
    <View>
      <OxyLogo />
      <Avatar userId="user123" size={40} />
      <FollowButton userId="user123" />
      <OxySignInButton onPress={() => showBottomSheet('SignIn')} />
    </View>
  );
}`,
          language: 'typescript',
        },
        {
          id: 'file-management',
          title: 'File Management',
          content: 'Upload and manage files:',
          code: `// Upload file
const file = { 
  uri: 'file://path/to/file',
  name: 'photo.jpg',
  type: 'image/jpeg' 
};
const result = await oxyClient.uploadFile(file);

// Get file URL
const downloadUrl = oxyClient.getFileDownloadUrl('file123');
const streamUrl = oxyClient.getFileStreamUrl('file123');

// List and delete files
const files = await oxyClient.listUserFiles('user123');
await oxyClient.deleteFile('file123');`,
          language: 'typescript',
        },
        {
          id: 'advanced-features',
          title: 'Advanced Features',
          content: 'Additional capabilities:',
          code: `// Notifications
const notifications = await oxyClient.getNotifications();
await oxyClient.markNotificationAsRead('notif123');
const unreadCount = await oxyClient.getUnreadCount();

// Karma System
const karma = await oxyClient.getUserKarma('user123');
await oxyClient.giveKarma('user123', 10, 'helpful comment');

// Location Services
await oxyClient.updateLocation(40.7128, -74.0060);
const nearby = await oxyClient.getNearbyUsers(1000);

// Analytics
await oxyClient.trackEvent('user_action', { action: 'click' });`,
          language: 'typescript',
        },
      ],
    },
  },
  {
    id: 'security',
    title: 'Security',
    description: 'Best practices for keeping your integration secure',
    category: 'Best Practices',
    content: {
      introduction: 'Security is critical when integrating with any API. Follow these best practices to keep your integration secure.',
      sections: [
        {
          id: 'credentials',
          title: 'Protect Your Credentials',
          content: 'Never expose your App Secret in client-side code or commit it to version control.',
          code: `// ✅ Good - use environment variables
const appSecret = process.env.APP_SECRET;

// ❌ Bad - hardcoded secret
const appSecret = 'sk_live_abc123...';`,
          language: 'javascript',
          warning: 'Exposed secrets can lead to unauthorized access to your account.',
        },
        {
          id: 'https',
          title: 'Always Use HTTPS',
          content: 'Make sure all API requests use HTTPS to prevent man-in-the-middle attacks.',
          tip: 'The Oxy API automatically redirects HTTP requests to HTTPS.',
        },
        {
          id: 'rotate',
          title: 'Rotate Credentials Regularly',
          content: 'Periodically regenerate your credentials and update your application. If you suspect a credential has been compromised, regenerate it immediately.',
        },
        {
          id: 'validate',
          title: 'Validate Webhook Signatures',
          content: 'Always verify webhook signatures to ensure requests are from Oxy and haven\'t been tampered with.',
        },
        {
          id: 'least-privilege',
          title: 'Principle of Least Privilege',
          content: 'Only request the minimum permissions necessary for your integration to function.',
        },
      ],
    },
  },
];

// Group pages by category
const categories = Array.from(new Set(docPages.map(p => p.category)));

export default function ExploreScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { width } = useWindowDimensions();

  const selectedPage = selectedPageId
    ? docPages.find(p => p.id === selectedPageId)
    : null;

  const isWeb = Platform.OS === 'web';
  const isMobile = width < 768;
  const isTablet = width >= 768 && width < 1024;

  const handleExternalDocPress = (url: string) => {
    Linking.openURL(url);
  };

  // Search functionality
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const query = searchQuery.toLowerCase();
    const results: Array<{
      page: DocPage;
      section?: DocPage['content']['sections'][0];
      matchType: 'title' | 'description' | 'content' | 'code';
    }> = [];

    docPages.forEach(page => {
      // Search in page title
      if (page.title.toLowerCase().includes(query)) {
        results.push({ page, matchType: 'title' });
      }
      // Search in page description
      else if (page.description.toLowerCase().includes(query)) {
        results.push({ page, matchType: 'description' });
      }
      // Search in sections
      else {
        page.content.sections.forEach(section => {
          if (
            section.title.toLowerCase().includes(query) ||
            section.content.toLowerCase().includes(query) ||
            section.code?.toLowerCase().includes(query)
          ) {
            results.push({
              page,
              section,
              matchType: section.code?.toLowerCase().includes(query) ? 'code' : 'content',
            });
          }
        });
      }
    });

    return results;
  }, [searchQuery]);

  // Filtered pages based on search
  const filteredPages = useMemo(() => {
    if (!searchQuery.trim()) return docPages;
    return Array.from(new Set(searchResults.map(r => r.page)));
  }, [searchQuery, searchResults]);  // Sidebar component
  const Sidebar = () => (
    <View style={[
      styles.sidebar,
      { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F8F9FA' },
      isMobile && styles.sidebarMobile
    ]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Search Bar */}
        <View style={[styles.searchContainer, { backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#FFFFFF' }]}>
          <Ionicons name="search" size={18} color={colors.icon} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search documentation..."
            placeholderTextColor={colors.icon}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery !== '' && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.icon} />
            </TouchableOpacity>
          )}
        </View>

        {/* Search Results */}
        {searchQuery.trim() !== '' ? (
          <View style={styles.searchResults}>
            <ThemedText style={styles.searchResultsTitle}>
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </ThemedText>
            {searchResults.map((result, index) => (
              <TouchableOpacity
                key={`${result.page.id}-${index}`}
                style={[
                  styles.searchResultItem,
                  { backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#FFFFFF' }
                ]}
                onPress={() => {
                  setSelectedPageId(result.page.id);
                  setShowSidebar(false);
                  if (isMobile) setSearchQuery('');
                }}
              >
                <View style={styles.searchResultHeader}>
                  <ThemedText style={styles.searchResultTitle}>{result.page.title}</ThemedText>
                  <View style={[styles.matchTypeBadge, { backgroundColor: colors.tint + '20' }]}>
                    <ThemedText style={[styles.matchTypeText, { color: colors.tint }]}>
                      {result.matchType}
                    </ThemedText>
                  </View>
                </View>
                {result.section && (
                  <ThemedText style={[styles.searchResultSection, { color: colors.icon }]}>
                    {result.section.title}
                  </ThemedText>
                )}
                <ThemedText style={[styles.searchResultDescription, { color: colors.icon }]} numberOfLines={2}>
                  {result.section?.content || result.page.description}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          /* Category Navigation */
          <>
            {categories.map(category => (
              <View key={category} style={styles.sidebarCategory}>
                <ThemedText style={styles.categoryTitle}>{category}</ThemedText>
                {filteredPages
                  .filter(p => p.category === category)
                  .map(page => (
                    <TouchableOpacity
                      key={page.id}
                      style={[
                        styles.sidebarItem,
                        selectedPageId === page.id && { backgroundColor: colors.tint + '20' }
                      ]}
                      onPress={() => {
                        setSelectedPageId(page.id);
                        setShowSidebar(false);
                      }}
                    >
                      <ThemedText
                        style={[
                          styles.sidebarItemText,
                          selectedPageId === page.id && { color: colors.tint, fontWeight: '600' }
                        ]}
                      >
                        {page.title}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
              </View>
            ))}

            {/* External Docs Category */}
            {externalDocs.length > 0 && (
              <View style={styles.sidebarCategory}>
                <ThemedText style={styles.categoryTitle}>Ecosystem Apps</ThemedText>
                {externalDocs.map(doc => (
                  <TouchableOpacity
                    key={doc.id}
                    style={styles.sidebarItem}
                    onPress={() => handleExternalDocPress(doc.url)}
                  >
                    <View style={styles.externalDocItem}>
                      {doc.icon && (
                        <Ionicons name={doc.icon as any} size={16} color={colors.icon} style={styles.externalDocIcon} />
                      )}
                      <ThemedText style={styles.sidebarItemText}>
                        {doc.title}
                      </ThemedText>
                      <Ionicons name="open-outline" size={14} color={colors.icon} />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );

  // Content component
  const Content = () => {
    if (!selectedPage) {
      return (
        <View style={styles.welcome}>
          <View style={[styles.welcomeIcon, { backgroundColor: colors.tint + '20' }]}>
            <Ionicons name="book" size={64} color={colors.tint} />
          </View>
          <ThemedText type="title" style={styles.welcomeTitle}>
            Oxy API Documentation
          </ThemedText>
          <ThemedText style={[styles.welcomeDescription, { color: colors.icon }]}>
            Build powerful integrations with the Oxy platform
          </ThemedText>
          <View style={styles.welcomeCards}>
            <TouchableOpacity
              style={[styles.welcomeCard, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF' }]}
              onPress={() => setSelectedPageId('quick-start')}
            >
              <Ionicons name="rocket" size={32} color={colors.tint} />
              <ThemedText type="subtitle" style={styles.welcomeCardTitle}>Quick Start</ThemedText>
              <ThemedText style={[styles.welcomeCardText, { color: colors.icon }]}>
                Get started in 5 minutes
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.welcomeCard, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF' }]}
              onPress={() => setSelectedPageId('authentication')}
            >
              <Ionicons name="key" size={32} color="#FF9500" />
              <ThemedText type="subtitle" style={styles.welcomeCardTitle}>Authentication</ThemedText>
              <ThemedText style={[styles.welcomeCardText, { color: colors.icon }]}>
                Secure your API requests
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.welcomeCard, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF' }]}
              onPress={() => setSelectedPageId('webhooks')}
            >
              <Ionicons name="git-branch" size={32} color="#34C759" />
              <ThemedText type="subtitle" style={styles.welcomeCardTitle}>Webhooks</ThemedText>
              <ThemedText style={[styles.welcomeCardText, { color: colors.icon }]}>
                Real-time notifications
              </ThemedText>
            </TouchableOpacity>
          </View>

          {/* Ecosystem Apps Section */}
          <View style={styles.ecosystemSection}>
            <ThemedText type="subtitle" style={styles.ecosystemTitle}>
              Ecosystem Apps
            </ThemedText>
            <ThemedText style={[styles.ecosystemDescription, { color: colors.icon }]}>
              Explore documentation for other Oxy ecosystem applications
            </ThemedText>
            <View style={styles.ecosystemCards}>
              {externalDocs.map(doc => (
                <TouchableOpacity
                  key={doc.id}
                  style={[styles.ecosystemCard, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF' }]}
                  onPress={() => handleExternalDocPress(doc.url)}
                >
                  {doc.icon && (
                    <Ionicons name={doc.icon as any} size={32} color={colors.tint} />
                  )}
                  <View style={styles.ecosystemCardContent}>
                    <ThemedText type="subtitle" style={styles.ecosystemCardTitle}>
                      {doc.title}
                    </ThemedText>
                    <ThemedText style={[styles.ecosystemCardText, { color: colors.icon }]}>
                      {doc.description}
                    </ThemedText>
                  </View>
                  <Ionicons name="open-outline" size={20} color={colors.icon} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      );
    }

    return (
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.breadcrumb}>
          <TouchableOpacity onPress={() => setSelectedPageId(null)}>
            <ThemedText style={[styles.breadcrumbText, { color: colors.tint }]}>
              Documentation
            </ThemedText>
          </TouchableOpacity>
          <ThemedText style={[styles.breadcrumbText, { color: colors.icon }]}> / </ThemedText>
          <ThemedText style={styles.breadcrumbText}>{selectedPage.title}</ThemedText>
        </View>

        <ThemedText type="title" style={styles.pageTitle}>{selectedPage.title}</ThemedText>
        <ThemedText style={[styles.pageDescription, { color: colors.icon }]}>
          {selectedPage.description}
        </ThemedText>

        <Card style={styles.contentCard}>
          <ThemedText style={styles.introduction}>
            {selectedPage.content.introduction}
          </ThemedText>

          {selectedPage.content.sections.map((section) => (
            <View key={section.id} style={styles.section}>
              <ThemedText type="subtitle" style={styles.sectionTitle}>
                {section.title}
              </ThemedText>
              <ThemedText style={[styles.sectionContent, { color: colors.text }]}>
                {section.content}
              </ThemedText>

              {section.tip && (
                <View style={[styles.callout, styles.calloutTip, { backgroundColor: '#34C759' + '15', borderLeftColor: '#34C759' }]}>
                  <Ionicons name="bulb" size={20} color="#34C759" style={styles.calloutIcon} />
                  <ThemedText style={styles.calloutText}>{section.tip}</ThemedText>
                </View>
              )}

              {section.warning && (
                <View style={[styles.callout, styles.calloutWarning, { backgroundColor: '#FF9500' + '15', borderLeftColor: '#FF9500' }]}>
                  <Ionicons name="warning" size={20} color="#FF9500" style={styles.calloutIcon} />
                  <ThemedText style={styles.calloutText}>{section.warning}</ThemedText>
                </View>
              )}

              {section.note && (
                <View style={[styles.callout, styles.calloutNote, { backgroundColor: colors.tint + '15', borderLeftColor: colors.tint }]}>
                  <Ionicons name="information-circle" size={20} color={colors.tint} style={styles.calloutIcon} />
                  <ThemedText style={styles.calloutText}>{section.note}</ThemedText>
                </View>
              )}

              {section.code && (
                <View style={[styles.codeBlock, { backgroundColor: colorScheme === 'dark' ? '#000' : '#F5F5F7' }]}>
                  <ThemedText style={[styles.code, { fontFamily: 'monospace' }]}>
                    {section.code}
                  </ThemedText>
                </View>
              )}
            </View>
          ))}
        </Card>

        <View style={styles.pagination}>
          {selectedPageId && docPages.findIndex(p => p.id === selectedPageId) > 0 && (
            <TouchableOpacity
              style={[styles.paginationButton, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F8F9FA' }]}
              onPress={() => {
                const currentIndex = docPages.findIndex(p => p.id === selectedPageId);
                setSelectedPageId(docPages[currentIndex - 1].id);
              }}
            >
              <Ionicons name="arrow-back" size={20} color={colors.tint} />
              <View style={styles.paginationTextContainer}>
                <ThemedText style={[styles.paginationLabel, { color: colors.icon }]}>Previous</ThemedText>
                <ThemedText style={styles.paginationTitle}>
                  {docPages[docPages.findIndex(p => p.id === selectedPageId) - 1].title}
                </ThemedText>
              </View>
            </TouchableOpacity>
          )}
          {selectedPageId && docPages.findIndex(p => p.id === selectedPageId) < docPages.length - 1 && (
            <TouchableOpacity
              style={[styles.paginationButton, styles.paginationNext, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F8F9FA' }]}
              onPress={() => {
                const currentIndex = docPages.findIndex(p => p.id === selectedPageId);
                setSelectedPageId(docPages[currentIndex + 1].id);
              }}
            >
              <View style={styles.paginationTextContainer}>
                <ThemedText style={[styles.paginationLabel, { color: colors.icon }]}>Next</ThemedText>
                <ThemedText style={styles.paginationTitle}>
                  {docPages[docPages.findIndex(p => p.id === selectedPageId) + 1].title}
                </ThemedText>
              </View>
              <Ionicons name="arrow-forward" size={20} color={colors.tint} />
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        {isMobile && (
          <TouchableOpacity onPress={() => setShowSidebar(!showSidebar)}>
            <Ionicons name="menu" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
        <ThemedText type="title">Documentation</ThemedText>
        <UserAvatar size={32} />
      </View>

      <View style={styles.layout}>
        {((isWeb && !isMobile) || showSidebar) && <Sidebar />}
        <View style={styles.main}>
          <Content />
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  layout: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 260,
    padding: 16,
    borderRightWidth: 1,
    borderRightColor: '#E5E5E7',
  },
  sidebarMobile: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 16,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  searchResults: {
    marginTop: 8,
  },
  searchResultsTitle: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  searchResultItem: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  searchResultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  searchResultTitle: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  matchTypeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  matchTypeText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  searchResultSection: {
    fontSize: 12,
    marginBottom: 4,
  },
  searchResultDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  sidebarCategory: {
    marginBottom: 20,
  },
  categoryTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    opacity: 0.6,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  sidebarItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 2,
  },
  sidebarItemText: {
    fontSize: 14,
  },
  main: {
    flex: 1,
  },
  welcome: {
    padding: 40,
    alignItems: 'center',
  },
  welcomeIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  welcomeTitle: {
    marginBottom: 12,
    textAlign: 'center',
  },
  welcomeDescription: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 40,
  },
  welcomeCards: {
    flexDirection: 'row',
    gap: 20,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  welcomeCard: {
    width: 200,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  welcomeCardTitle: {
    marginTop: 16,
    marginBottom: 8,
  },
  welcomeCardText: {
    fontSize: 13,
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 40,
  },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  breadcrumbText: {
    fontSize: 14,
  },
  pageTitle: {
    marginBottom: 8,
  },
  pageDescription: {
    fontSize: 18,
    marginBottom: 32,
  },
  contentCard: {
    padding: 32,
  },
  introduction: {
    fontSize: 16,
    lineHeight: 26,
    marginBottom: 32,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 22,
    marginBottom: 12,
  },
  sectionContent: {
    fontSize: 16,
    lineHeight: 26,
    marginBottom: 16,
  },
  callout: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 8,
    borderLeftWidth: 4,
    marginVertical: 12,
  },
  calloutTip: {},
  calloutWarning: {},
  calloutNote: {},
  calloutIcon: {
    marginRight: 12,
  },
  calloutText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 22,
  },
  codeBlock: {
    padding: 20,
    borderRadius: 12,
    marginTop: 12,
  },
  code: {
    fontSize: 14,
    lineHeight: 22,
  },
  pagination: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 40,
  },
  paginationButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  paginationNext: {
    justifyContent: 'flex-end',
  },
  paginationTextContainer: {
    flex: 1,
  },
  paginationLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  paginationTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  externalDocItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  externalDocIcon: {
    marginRight: 4,
  },
  ecosystemSection: {
    marginTop: 48,
    width: '100%',
  },
  ecosystemTitle: {
    marginBottom: 12,
    textAlign: 'center',
  },
  ecosystemDescription: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  ecosystemCards: {
    gap: 16,
  },
  ecosystemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  ecosystemCardContent: {
    flex: 1,
  },
  ecosystemCardTitle: {
    marginBottom: 4,
  },
  ecosystemCardText: {
    fontSize: 13,
  },
});
