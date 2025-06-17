# FormData Runtime Error Fix for React Native/Expo with Hermes

## Problem
When using `@oxyhq/services` in React Native applications with Expo and the Hermes JavaScript engine, you may encounter the error:

```
ReferenceError: Property 'FormData' doesn't exist, js engine: hermes
```

This occurs because Hermes doesn't include all web APIs like `FormData` by default.

## Solution
This package (version 5.3.10 and later) includes automatic polyfills for React Native environments that lack native FormData support.

### What was fixed:
1. **Automatic polyfill detection**: The library now detects when FormData is not available and uses the `form-data` package as a fallback
2. **Cross-platform compatibility**: Works seamlessly across Node.js, browsers, and React Native/Expo
3. **Zero configuration**: No additional setup required from users

### Implementation details:
- Added `utils/polyfills.ts` with automatic FormData polyfill
- Modified `core/index.ts` to use polyfilled FormData when native is unavailable
- Updated entry points to load polyfills automatically
- Enhanced error handling and cross-platform type safety

## Usage
The fix is automatic. Simply install or upgrade to the latest version:

```bash
npm install @oxyhq/services@latest
```

File uploads will work across all supported platforms:

```typescript
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({ baseURL: 'your-api-url' });

// This will work in React Native/Expo, browsers, and Node.js
const result = await oxy.files.uploadFile(file, 'filename.jpg', { 
  description: 'A test file' 
});
```

## Dependencies
The `form-data` package is included as a dependency and will be used automatically when needed.

## Testing
Run the included tests to verify the polyfill works:

```bash
npm test
```

## Supported Environments
- ✅ React Native with Hermes
- ✅ Expo (all engines)
- ✅ React/Next.js (browsers)
- ✅ Node.js
- ✅ React Native with JSC
