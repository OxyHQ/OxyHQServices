# Getting Started with Oxy

Welcome to Oxy! This guide will help you integrate Oxy into your application in just a few minutes.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Platform-Specific Setup](#platform-specific-setup)
- [Your First Integration](#your-first-integration)
- [Next Steps](#next-steps)

## Installation

### Prerequisites

- **Node.js**: 16+ (for backend) or 18+ (recommended)
- **React Native**: 0.60+ (for mobile apps)
- **TypeScript**: 4.0+ (optional but recommended)

### Install the Package

```bash
npm install @oxyhq/services
```

### Install Peer Dependencies

For React Native/Expo projects, install the required peer dependencies:

```bash
npm install react-native-reanimated react-native-gesture-handler \
  react-native-safe-area-context react-native-svg \
  @react-native-async-storage/async-storage
```

For Expo projects, also install:

```bash
npx expo install expo expo-font expo-image expo-linear-gradient
```

## Oxy Infrastructure

Oxy services are distributed across three specialized domains:

| Domain | Purpose | Use For |
|--------|---------|---------|
| **api.oxy.so** | API | All data operations - users, sessions, posts, social features |
| **auth.oxy.so** | Authentication | Identity provider - login, signup, SSO, FedCM |
| **cloud.oxy.so** | Media/CDN | File storage, images, videos, static assets |

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  auth.oxy.so    │     │   api.oxy.so    │     │  cloud.oxy.so   │
│  (Identity)     │     │   (Data API)    │     │  (Media CDN)    │
│                 │     │                 │     │                 │
│  • Login/Signup │     │  • Users        │     │  • Images       │
│  • SSO/FedCM    │     │  • Sessions     │     │  • Videos       │
│  • OAuth flows  │     │  • Posts        │     │  • Files        │
│                 │     │  • Social       │     │  • Avatars      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Quick Start

### React Native / Expo (Recommended)

1. **Add the polyfill** (required for file uploads):

```javascript
// index.js or App.js (very first line, before any other imports)
import 'react-native-url-polyfill/auto';
```

2. **Wrap your app with OxyProvider**:

```typescript
// App.tsx
import { OxyProvider } from '@oxyhq/services';
import { YourApp } from './YourApp';

export default function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}
```

3. **Use Oxy in your components**:

```typescript
// components/UserProfile.tsx
import { useOxy } from '@oxyhq/services';
import { View, Text, Button } from 'react-native';

export function UserProfile() {
  const { user, isAuthenticated, login, logout } = useOxy();

  if (!isAuthenticated) {
    return (
      <View>
        <Text>Please sign in</Text>
        <Button title="Sign In" onPress={() => login('username', 'password')} />
      </View>
    );
  }

  return (
    <View>
      <Text>Welcome, {user?.name}!</Text>
      <Button title="Sign Out" onPress={logout} />
    </View>
  );
}
```

### Web (React)

```typescript
// App.tsx
import { OxyProvider } from '@oxyhq/services';
import { YourApp } from './YourApp';

export default function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}
```

### Node.js / Express

```typescript
// server.ts
import express from 'express';
import { oxyClient } from '@oxyhq/core';

const app = express();
app.use(express.json());

// Authentication endpoint
app.post('/api/auth/signin', async (req, res) => {
  try {
    const { username, password } = req.body;
    const session = await oxyClient.signIn(username, password);
    res.json(session);
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

// Get user profile
app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await oxyClient.getUserById(req.params.id);
    res.json(user);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

## Frontend vs Backend Usage

Oxy ships with two entry points. Pick the one that matches your environment so that you only pull in the code you need.

### Frontend (React Native, React, Expo)

- **Import path:** `import { OxyProvider, useOxy, useFollow, ... } from '@oxyhq/services';`
- Wrap your app with `OxyProvider` to get the context, hooks, and UI components.
- Hooks such as `useOxy`, `useFollow`, `useI18n`, etc., as well as components like `OxySignInButton` and `FollowButton`, are only available in frontend/React environments.
- Make sure the required peer dependencies are installed (Reanimated, Gesture Handler, etc.) and add `import 'react-native-url-polyfill/auto'` when running on React Native/Expo so uploads work.

### Backend (Node.js, serverless, API routes)

- **Import path:** `import { oxyClient, OxyServices } from '@oxyhq/core';`
- The `@oxyhq/core` package contains only the TypeScript client—no React or React Native code—so it is safe for Node.js, Express, Next.js API routes, and serverless functions.
- Use the preconfigured `oxyClient` for convenience, or instantiate your own `new OxyServices({ baseURL })` if you need custom configuration or multiple instances.
- You can reuse tokens generated on the frontend (`OxyProvider`) by sending them to your backend via headers or cookies—the backend `oxyClient` understands the same token format.
- The backend bundle also exposes helpers such as `oxyClient.auth()` for Express middleware.

> **Tip:** In SSR frameworks (Next.js, Remix, etc.) import UI hooks/components from `@oxyhq/services` in client components and import `@oxyhq/core` anywhere that runs on the server (API routes, middleware, server components).

## Platform-Specific Setup

### React Native

1. **Install dependencies**:
```bash
npm install @oxyhq/services react-native-reanimated react-native-gesture-handler
```

2. **Add polyfill** (first line of `index.js`):
```javascript
import 'react-native-url-polyfill/auto';
```

3. **Configure Reanimated** (if using React Native CLI):
```javascript
// babel.config.js
module.exports = {
  plugins: ['react-native-reanimated/plugin'],
};
```

### Expo

1. **Install dependencies**:
```bash
npx expo install @oxyhq/services expo expo-font expo-image expo-linear-gradient
```

2. **Add polyfill** (first line of `App.js`):
```javascript
import 'react-native-url-polyfill/auto';
```

3. **No additional configuration needed!** Expo handles everything automatically.

### Next.js

```typescript
// app/layout.tsx or pages/_app.tsx
import { OxyProvider } from '@oxyhq/services';

export default function RootLayout({ children }) {
  return (
    <OxyProvider baseURL={process.env.NEXT_PUBLIC_OXY_API_URL || 'https://api.oxy.so'}>
      {children}
    </OxyProvider>
  );
}
```

### Vue.js

```typescript
// main.ts
import { createApp } from 'vue';
import { OxyProvider } from '@oxyhq/services';
import App from './App.vue';

// Note: OxyProvider is React-based, so you'll need to use the core API directly
// See "Using Core API" section below
```

## Your First Integration

### Step 1: Authentication

```typescript
import { useOxy } from '@oxyhq/services';

function LoginScreen() {
  const { login, isAuthenticated, user } = useOxy();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async () => {
    try {
      await login(username, password);
      console.log('Logged in as:', user?.name);
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  if (isAuthenticated) {
    return <Text>Already logged in as {user?.name}</Text>;
  }

  return (
    <View>
      <TextInput value={username} onChangeText={setUsername} placeholder="Username" />
      <TextInput value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
      <Button title="Sign In" onPress={handleLogin} />
    </View>
  );
}
```

### Step 2: Fetch User Data

```typescript
import { useOxy } from '@oxyhq/services';
import { useEffect, useState } from 'react';

function UserProfile() {
  const { oxyServices, user, isAuthenticated } = useOxy();
  const [followers, setFollowers] = useState([]);

  useEffect(() => {
    if (isAuthenticated && user) {
      // Fetch user followers
      oxyServices.getUserFollowers(user.id)
        .then(result => setFollowers(result.followers))
        .catch(error => console.error('Failed to fetch followers:', error));
    }
  }, [isAuthenticated, user]);

  if (!isAuthenticated) {
    return <Text>Please sign in</Text>;
  }

  return (
    <View>
      <Text>Welcome, {user?.name}!</Text>
      <Text>Followers: {followers.length}</Text>
    </View>
  );
}
```

### Step 3: Upload Files

```typescript
import { useOxy } from '@oxyhq/services';
import * as ImagePicker from 'expo-image-picker';

function AvatarUpload() {
  const { oxyServices, user } = useOxy();
  const [uploading, setUploading] = useState(false);

  const pickAndUploadImage = async () => {
    try {
      // Request permissions
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        alert('Permission denied');
        return;
      }

      // Pick image
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 1,
      });

      if (!result.canceled && result.assets[0]) {
        setUploading(true);
        
        // Convert to File/Blob
        const response = await fetch(result.assets[0].uri);
        const blob = await response.blob();
        const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });

        // Upload to Oxy
        const uploaded = await oxyServices.uploadRawFile(file, 'public');
        console.log('Uploaded file:', uploaded);

        // Update user profile with new avatar
        if (user) {
          await oxyServices.updateProfile({ avatar: uploaded.file.id });
        }
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <View>
      <Button 
        title={uploading ? "Uploading..." : "Upload Avatar"} 
        onPress={pickAndUploadImage}
        disabled={uploading}
      />
    </View>
  );
}
```

## Next Steps

Now that you have Oxy integrated, explore these features:

1. **[Authentication Guide](./AUTHENTICATION.md)** - Deep dive into authentication flows
2. **[API Reference](./API_REFERENCE.md)** - Complete API documentation
3. **[UI Components](./UI_COMPONENTS.md)** - Pre-built React Native components
4. **[Best Practices](./BEST_PRACTICES.md)** - Production-ready patterns
5. **[Examples](./EXAMPLES.md)** - Complete working examples

## Need Help?

- 📖 [Full Documentation](./README.md)
- 💬 [GitHub Issues](https://github.com/OxyHQ/OxyHQServices/issues)
- 🌐 [Website](https://oxy.so)

