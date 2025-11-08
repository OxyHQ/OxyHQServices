# Oxy Developer Portal

A React Native application for managing developer apps, API keys, and webhooks for the Oxy platform.

## Features

- � **Authentication Required** - Sign in with your Oxy account
- �🔑 **API Key Management** - Create and manage developer applications with API keys and secrets
- 🪝 **Webhook Configuration** - Set up webhooks to receive notifications when files are deleted or visibility changes
- 🔒 **Secure Credentials** - API secrets are only shown once during creation
- 📱 **Cross-Platform** - Built with Expo, runs on iOS, Android, and Web

## Prerequisites

- Node.js 18+
- npm 9+
- Expo CLI
- **Running API Server** - The Oxy API must be running on `http://localhost:3001`

## Getting Started

### 1. Start the API Server

First, make sure the Oxy API is running:

```bash
# From the root of the monorepo
cd packages/api
npm run dev
```

The API should be running on `http://localhost:3001`

### 2. Install Dependencies

```bash
cd packages/DeveloperPortal
npm install
```

### 3. Configure Environment

The `.env` file should already exist with:
```
EXPO_PUBLIC_API_URL=http://localhost:3001
```

### 4. Start the Developer Portal

```bash
npm start
```

Choose your platform:
- Press `w` for web
- Press `i` for iOS simulator
- Press `a` for Android emulator

## Usage

### Sign In

1. Open the Developer Portal
2. You'll see "Sign in to continue"
3. Tap "Sign In" to open the authentication flow
4. Sign in with your Oxy account credentials
5. Once authenticated, you can create and manage apps

### Creating a Developer App

1. Open the Developer Portal
2. Tap "Create App"
3. Fill in:
   - **App Name** (required)
   - **Description** (optional)
   - **Webhook URL** (optional) - Receive notifications for file events
4. Tap "Create App"
5. **IMPORTANT**: Save the API Secret immediately - it's only shown once!

### Managing Apps

- **View Apps**: See all your developer applications on the home screen
- **Edit App**: Update name, description, or webhook URL
- **Regenerate Secret**: Create a new API secret (invalidates the old one)
- **Delete App**: Permanently remove an application

### API Credentials

Each app receives:
- **API Key** (`dk_...`) - Public identifier for your app
- **API Secret** (shown once) - Secret credential for authentication
- **Webhook Secret** (if webhook URL set) - Used to verify webhook signatures

### Webhook Integration

When you set a webhook URL, your app will receive POST requests for these events:

**File Deleted:**
```json
{
  "event": "deleted",
  "fileId": "abc123",
  "link": {
    "app": "your-app-name",
    "entityType": "post",
    "entityId": "post-123"
  },
  "timestamp": "2025-11-08T12:00:00Z"
}
```

**File Visibility Changed:**
```json
{
  "event": "visibility_changed",
  "fileId": "abc123",
  "visibility": "public",
  "link": {
    "app": "your-app-name",
    "entityType": "post",
    "entityId": "post-123"
  },
  "timestamp": "2025-11-08T12:00:00Z"
}
```

## Architecture

- **Backend API**: `/api/developer` routes in `packages/api`
- **OxyServices**: Developer API methods in `packages/services/src/core/OxyServices.ts`
- **Frontend**: Expo Router app with screens:
  - `app/(tabs)/index.tsx` - App list and management
  - `app/create-app.tsx` - Create new developer app
  - `app/app/[id].tsx` - View and edit app details

## Security Best Practices

1. **Never commit API secrets** - Store them securely in your app
2. **Verify webhook signatures** - Use the webhook secret to validate requests
3. **Rotate secrets regularly** - Use the regenerate feature periodically
4. **Limit scopes** - Only request the permissions your app needs
5. **Use HTTPS** - Always use secure webhook URLs in production

## Development

### Build Commands

```bash
# Start development server
npm start

# Run on specific platform
npm run ios
npm run android
npm run web

# Type checking
npm run lint
```

### Linking Local Services

The app uses the local `@oxyhq/services` package:
```bash
npm link ../services
```

## Learn More

- [Oxy API Documentation](https://docs.oxy.so)
- [Expo Documentation](https://docs.expo.dev)
- [React Native](https://reactnative.dev)