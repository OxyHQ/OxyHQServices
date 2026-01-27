# @oxyhq/services Platform Guide

Complete guide for using @oxyhq/services across different platforms and environments.

## Quick Reference

| Platform | Entry Point | Provider | Bundler Config | react-native-web |
|----------|------------|----------|----------------|------------------|
| **Expo 54 Native** | `@oxyhq/services` | `OxyProvider` | ❌ None | ❌ Not needed |
| **Expo 54 Web** | `@oxyhq/services` | `OxyProvider` | ✅ Built-in | ✅ Built-in |
| **Vite/React** | `@oxyhq/services/web` | `WebOxyProvider` | ❌ None | ❌ Not needed |
| **Next.js** | `@oxyhq/services/web` | `WebOxyProvider` | ❌ None | ❌ Not needed |
| **Node.js** | `@oxyhq/services/core` | N/A (backend) | ❌ None | ❌ Not needed |

## Entry Points Explained

### 1. Main Entry Point: `@oxyhq/services`

**Use for:**
- Expo apps (native + web)
- React Native apps

**What you get:**
- Everything: Core API, UI components, hooks, stores
- Both `OxyProvider` (universal) and `WebOxyProvider` (web-only)
- Full React Native component support

**Example:**
```typescript
import { OxyProvider, useAuth, OxyServices } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}
```

**Platform Resolution:**
- **Metro (React Native)**: Resolves to `src/index.ts` (source files)
- **Expo Web**: Resolves to `lib/module/index.js` (pre-built with react-native-web)
- **Vite/Webpack**: Resolves to `lib/module/index.js` (requires react-native-web setup)
- **Node.js**: Resolves to `lib/module/core/index.js` (core-only, no UI)

---

### 2. Web Entry Point: `@oxyhq/services/web` ✨ NEW

**Use for:**
- Pure React apps (Vite, Create React App)
- Next.js apps
- Any web-only application without Expo

**What you get:**
- Core API, `WebOxyProvider`, hooks, stores
- NO React Native UI components (OxyProvider excluded)
- NO React Native dependencies

**Benefits:**
- ✅ Smaller bundle size (~30% smaller)
- ✅ No bundler configuration needed
- ✅ No react-native-web required
- ✅ Faster builds

**Example:**
```typescript
import { WebOxyProvider, useAuth, OxyServices } from '@oxyhq/services/web';

function App() {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </WebOxyProvider>
  );
}
```

**Platform Resolution:**
- **All bundlers**: Resolves to `lib/module/web.js` (pre-built, web-only)

---

### 3. Core Entry Point: `@oxyhq/services/core`

**Use for:**
- Node.js backends (Express, Fastify, etc.)
- Server-side applications
- Non-React environments

**What you get:**
- Core `OxyServices` class with all API methods
- Authentication utilities
- Type definitions
- NO React or UI components

**Example:**
```typescript
import { OxyServices, oxyClient } from '@oxyhq/services/core';

const app = express();

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const session = await oxyClient.signIn(username, password);
  res.json(session);
});
```

**Platform Resolution:**
- **Node.js**: Resolves to `lib/module/core/index.js` or `lib/commonjs/core/index.js`

---

### 4. UI Entry Point: `@oxyhq/services/ui`

**Use for:**
- Advanced use cases where you only need UI components
- Apps that manage their own OxyServices instance

**What you get:**
- All UI components (OxyProvider, WebOxyProvider)
- Hooks, stores, and utilities
- NO core OxyServices class

**Example:**
```typescript
import { OxyProvider, useAuth } from '@oxyhq/services/ui';

// When you want to use UI but initialize OxyServices separately
```

---

### 5. Crypto Entry Point: `@oxyhq/services/crypto`

**Use for:**
- Apps that only need cryptography utilities
- Identity and signature services

**What you get:**
- `KeyManager`, `SignatureService`, `RecoveryPhraseService`
- Crypto utilities and polyfills

**Example:**
```typescript
import { KeyManager, SignatureService } from '@oxyhq/services/crypto';

const keyManager = new KeyManager();
const keyPair = await keyManager.generateKeyPair();
```

---

## Platform-Specific Setup

### Expo 54 (Native + Web)

**Installation:**
```bash
npm install @oxyhq/services
npm install react-native-reanimated react-native-gesture-handler \
  react-native-safe-area-context react-native-svg
```

**Usage:**
```typescript
// App.tsx
import 'react-native-url-polyfill/auto'; // ← Add at top of entry file
import { OxyProvider, useAuth } from '@oxyhq/services';

export default function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}
```

**Works on:**
- ✅ iOS
- ✅ Android
- ✅ Web (via Expo's built-in react-native-web)

---

### Vite (Pure React Web)

**Installation:**
```bash
npm install @oxyhq/services
```

**Usage:**
```typescript
// main.tsx
import { WebOxyProvider, useAuth } from '@oxyhq/services/web';

function App() {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </WebOxyProvider>
  );
}
```

**No configuration needed!** ✅

---

### Next.js

**Installation:**
```bash
npm install @oxyhq/services
```

**Usage:**
```typescript
// app/layout.tsx or pages/_app.tsx
import { WebOxyProvider } from '@oxyhq/services/web';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <WebOxyProvider baseURL="https://api.oxy.so">
          {children}
        </WebOxyProvider>
      </body>
    </html>
  );
}
```

**No configuration needed!** ✅

---

### Node.js (Backend)

**Installation:**
```bash
npm install @oxyhq/services
```

**Usage:**
```typescript
// server.ts
import { OxyServices, oxyClient } from '@oxyhq/services/core';
import express from 'express';

const app = express();
app.use(express.json());

app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const session = await oxyClient.signIn(username, password);
    res.json(session);
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

app.listen(3000);
```

---

## Advanced: Using Main Entry Point on Web

If you need to use the main entry point (`@oxyhq/services`) in a pure web app instead of `/web`, you'll need bundler configuration.

### Why?

The main entry point includes `OxyProvider` which uses React Native components. These need to be aliased to `react-native-web` on web platforms.

### Vite Configuration

**1. Install dependencies:**
```bash
npm install react-native-web buffer
```

**2. Update vite.config.ts:**
```typescript
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "react-native": "react-native-web",
      buffer: "buffer/",
    },
    extensions: ['.web.js', '.web.ts', '.web.tsx', '.js', '.ts', '.tsx', '.json'],
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
    global: 'globalThis',
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
  optimizeDeps: {
    include: ['elliptic', 'buffer', 'warn-once', 'react-native-is-edge-to-edge', 'hoist-non-react-statics'],
    exclude: [
      '@oxyhq/services',
      'react-native-reanimated',
      'react-native-gesture-handler',
      'react-native-svg',
      'react-native-screens',
      'react-native-safe-area-context',
      'lottie-react-native',
      'expo-image',
      'react-native-qrcode-svg',
    ],
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
})
```

**3. Add to index.html:**
```html
<body>
  <div id="root"></div>
  <script>
    // Polyfill for React Native packages
    if (typeof window.require === 'undefined') {
      window.require = function(module) {
        console.warn('require() called for:', module);
        return {};
      };
    }
  </script>
  <script type="module" src="/src/main.tsx"></script>
</body>
```

**Recommendation:** Use `@oxyhq/services/web` instead to avoid this configuration!

---

## Migration Guide

### From 5.21.x to 5.22.0

For pure web apps using Vite, Next.js, or CRA:

**Before:**
```typescript
import { WebOxyProvider, useAuth } from '@oxyhq/services';
// Required complex vite.config.ts with react-native-web
```

**After:**
```typescript
import { WebOxyProvider, useAuth } from '@oxyhq/services/web';
// No vite.config.ts changes needed!
```

**No changes needed for:**
- Expo apps (native + web)
- React Native apps
- Node.js backends

---

## Comparison: Main vs Web Entry Point

| Feature | `@oxyhq/services` | `@oxyhq/services/web` |
|---------|-------------------|----------------------|
| **Target** | Expo, React Native | Pure React web |
| **OxyProvider** | ✅ Yes | ❌ No |
| **WebOxyProvider** | ✅ Yes | ✅ Yes |
| **Core API** | ✅ Yes | ✅ Yes |
| **Hooks & Stores** | ✅ Yes | ✅ Yes |
| **React Native deps** | ✅ Yes | ❌ No |
| **Bundle size** | ~500KB | ~350KB |
| **Bundler config** | Required on web | ❌ None |
| **react-native-web** | Required on web | ❌ Not needed |

---

## Best Practices

### ✅ Do

1. **Use `/web` for pure web apps** - It's cleaner and faster
2. **Use main entry for Expo** - It's universal and works everywhere
3. **Use `/core` for backends** - Smallest footprint
4. **Import only what you need** - Tree-shaking works best with named imports

### ❌ Don't

1. **Don't use `OxyProvider` on pure web** - Use `WebOxyProvider` instead
2. **Don't use `WebOxyProvider` in Expo** - Use `OxyProvider` instead
3. **Don't mix entry points** - Pick one and stick with it
4. **Don't import UI in backends** - Use `/core` entry point

---

## Troubleshooting

### "react-native" not found

**Problem:** Using main entry point on pure web without configuration.

**Solution:** Either:
1. Use `@oxyhq/services/web` instead (recommended)
2. Add bundler configuration for react-native-web

### Bundle size too large

**Problem:** Web bundle includes React Native dependencies.

**Solution:** Switch from `@oxyhq/services` to `@oxyhq/services/web`

### OxyProvider not working on web

**Problem:** Using `OxyProvider` in pure web app.

**Solution:** Use `WebOxyProvider` from `@oxyhq/services/web` instead

### Module resolution errors in Node.js

**Problem:** Trying to use UI components in Node.js.

**Solution:** Use `@oxyhq/services/core` for backend applications

---

## Summary

- **Expo apps**: Use `@oxyhq/services` with `OxyProvider`
- **Pure web**: Use `@oxyhq/services/web` with `WebOxyProvider`
- **Node.js**: Use `@oxyhq/services/core`
- **Advanced**: Mix entry points as needed (`/ui`, `/crypto`, etc.)

The new `/web` entry point makes it easier than ever to use OxyHQ authentication in pure React web applications!
