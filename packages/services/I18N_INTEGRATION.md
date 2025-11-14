# Integrating OxyHQ Services Language with Your i18n System

This guide shows you how to integrate the language functionality from `@oxyhq/services` with your app's i18n (internationalization) system.

## Overview

OxyHQ Services provides language selection and storage functionality. When a user selects a language in the services UI, it's stored and can be accessed by your app. This guide shows you how to:

1. Get the selected language from services
2. Sync it with your i18n library (react-i18next, i18n-js, etc.)
3. Keep both systems in sync when the language changes

## Prerequisites

- `@oxyhq/services` installed in your app
- An i18n library installed (e.g., `react-i18next`, `i18n-js`, `next-intl`)

## Method 1: Using React Hook (Recommended for React Apps)

If you're using React, the easiest way is to use the `useOxy` hook to get the current language and sync it with your i18n system.

### Example with react-i18next

```typescript
// App.tsx or your root component
import { useEffect } from 'react';
import { useOxy } from '@oxyhq/services';
import { useTranslation } from 'react-i18next';

function App() {
  const { currentLanguage, currentLanguageName } = useOxy();
  const { i18n } = useTranslation();

  // Sync services language with react-i18next
  useEffect(() => {
    if (currentLanguage) {
      // Convert 'en-US' to 'en' if needed (react-i18next typically uses short codes)
      const languageCode = currentLanguage.split('-')[0];
      
      if (i18n.language !== languageCode) {
        i18n.changeLanguage(languageCode).catch(console.error);
      }
    }
  }, [currentLanguage, i18n]);

  return (
    // Your app content
  );
}
```

### Example with i18n-js

```typescript
// App.tsx
import { useEffect } from 'react';
import { useOxy } from '@oxyhq/services';
import i18n from './i18n'; // Your i18n configuration

function App() {
  const { currentLanguage } = useOxy();

  // Sync services language with i18n-js
  useEffect(() => {
    if (currentLanguage) {
      // i18n-js can use full codes like 'en-US' or short codes
      if (i18n.locale !== currentLanguage) {
        i18n.locale = currentLanguage;
      }
    }
  }, [currentLanguage]);

  return (
    // Your app content
  );
}
```

### Example with next-intl (Next.js)

```typescript
// app/layout.tsx or middleware
import { useOxy } from '@oxyhq/services';
import { NextIntlClientProvider } from 'next-intl';
import { useLocale } from 'next-intl';

function RootLayout({ children }) {
  const { currentLanguage } = useOxy();
  const locale = useLocale();

  // Convert services language to next-intl format
  const nextIntlLocale = currentLanguage.split('-')[0];

  return (
    <NextIntlClientProvider locale={nextIntlLocale}>
      {children}
    </NextIntlClientProvider>
  );
}
```

## Method 2: Using OxyServices Class (Non-React or Backend)

If you're not using React or need to access the language in backend code, use the `OxyServices` class methods.

### Getting Current Language

```typescript
import { OxyServices } from '@oxyhq/services/core';

const oxy = new OxyServices({
  baseURL: 'https://api.oxy.so',
});

// Get current language code (e.g., 'en-US')
const languageCode = await oxy.getCurrentLanguage();

// Get language name (e.g., 'English')
const languageName = await oxy.getCurrentLanguageName();

// Get native language name (e.g., 'Español')
const nativeName = await oxy.getCurrentNativeLanguageName();

// Get full metadata object
const metadata = await oxy.getCurrentLanguageMetadata();
// Returns: { id: 'en-US', name: 'English', nativeName: 'English', flag: '🇺🇸', ... }
```

### Using with Custom Storage Prefix

If your app uses a custom storage prefix:

```typescript
const languageCode = await oxy.getCurrentLanguage('my_app_session');
const languageName = await oxy.getCurrentLanguageName('my_app_session');
```

## Method 3: Direct Access to Language Utilities

You can also use the language utilities directly to work with language codes and metadata.

```typescript
import { 
  SUPPORTED_LANGUAGES,
  getLanguageMetadata,
  getLanguageName,
  getNativeLanguageName,
  normalizeLanguageCode
} from '@oxyhq/services';

// Get all supported languages
const allLanguages = SUPPORTED_LANGUAGES;

// Get metadata for a specific language code
const metadata = getLanguageMetadata('es-ES');
// Returns: { id: 'es-ES', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', ... }

// Get just the name
const name = getLanguageName('es-ES'); // 'Spanish'

// Get native name
const nativeName = getNativeLanguageName('es-ES'); // 'Español'

// Normalize a language code
const normalized = normalizeLanguageCode('en'); // 'en-US'
const normalized2 = normalizeLanguageCode('es'); // 'es-ES'
```

## Complete Integration Example

Here's a complete example that sets up bidirectional sync between services and your i18n system:

```typescript
// i18nSync.ts
import { useEffect, useRef } from 'react';
import { useOxy } from '@oxyhq/services';
import { useTranslation } from 'react-i18next';

/**
 * Hook to sync OxyHQ Services language with react-i18next
 */
export function useOxyI18nSync() {
  const { currentLanguage, setLanguage } = useOxy();
  const { i18n } = useTranslation();
  const isUpdatingRef = useRef(false);

  // Sync services language -> i18n
  useEffect(() => {
    if (currentLanguage && !isUpdatingRef.current) {
      const languageCode = currentLanguage.split('-')[0];
      if (i18n.language !== languageCode) {
        i18n.changeLanguage(languageCode).catch(console.error);
      }
    }
  }, [currentLanguage, i18n]);

  // Sync i18n language -> services (when changed externally)
  useEffect(() => {
    if (i18n.language && !isUpdatingRef.current) {
      // Convert 'en' to 'en-US' format
      const fullLanguageCode = normalizeLanguageCode(i18n.language);
      if (currentLanguage !== fullLanguageCode) {
        isUpdatingRef.current = true;
        setLanguage(fullLanguageCode).finally(() => {
          isUpdatingRef.current = false;
        });
      }
    }
  }, [i18n.language, currentLanguage, setLanguage]);

  return {
    currentLanguage,
    languageName: currentLanguageName,
    i18nLanguage: i18n.language,
  };
}

// In your App.tsx
function App() {
  useOxyI18nSync(); // Sync languages automatically

  return (
    // Your app
  );
}
```

## Displaying Current Language in Your UI

You can easily display the current language information from services:

```typescript
import { useOxy } from '@oxyhq/services';

function LanguageDisplay() {
  const { 
    currentLanguage, 
    currentLanguageName, 
    currentNativeLanguageName,
    currentLanguageMetadata 
  } = useOxy();

  return (
    <View>
      <Text>Language Code: {currentLanguage}</Text>
      <Text>Language Name: {currentLanguageName}</Text>
      {currentNativeLanguageName && (
        <Text>Native Name: {currentNativeLanguageName}</Text>
      )}
      {currentLanguageMetadata?.flag && (
        <Text style={{ fontSize: 24 }}>{currentLanguageMetadata.flag}</Text>
      )}
    </View>
  );
}
```

## Listening to Language Changes

If you need to perform actions when the language changes:

```typescript
import { useEffect } from 'react';
import { useOxy } from '@oxyhq/services';

function MyComponent() {
  const { currentLanguage } = useOxy();

  useEffect(() => {
    // This runs whenever the language changes
    console.log('Language changed to:', currentLanguage);
    
    // Update your i18n system here
    // Update document title, etc.
  }, [currentLanguage]);

  return null;
}
```

## Converting Between Language Code Formats

Different i18n libraries use different formats. Here's how to convert:

```typescript
import { normalizeLanguageCode } from '@oxyhq/services';

// Services uses BCP-47 format: 'en-US', 'es-ES'
// Some i18n libraries use short codes: 'en', 'es'

// To get short code from full code
const shortCode = 'en-US'.split('-')[0]; // 'en'

// To get full code from short code
const fullCode = normalizeLanguageCode('en'); // 'en-US'

// To match your i18n library format
function convertToI18nFormat(servicesLanguage: string, i18nFormat: 'full' | 'short' = 'short') {
  if (i18nFormat === 'short') {
    return servicesLanguage.split('-')[0];
  }
  return normalizeLanguageCode(servicesLanguage);
}
```

## Supported Languages

The following languages are supported by OxyHQ Services:

- English (en-US)
- Spanish (es-ES)
- Catalan (ca-ES)
- French (fr-FR)
- German (de-DE)
- Italian (it-IT)
- Portuguese (pt-PT)
- Japanese (ja-JP)
- Korean (ko-KR)
- Chinese (zh-CN)
- Arabic (ar-SA)

You can access the full list via:

```typescript
import { SUPPORTED_LANGUAGES } from '@oxyhq/services';

console.log(SUPPORTED_LANGUAGES);
// Array of language metadata objects
```

## Troubleshooting

### Language not syncing

1. Make sure `OxyProvider` wraps your app
2. Check that the storage key prefix matches if you're using a custom one
3. Verify that your i18n library is properly initialized

### Language code format mismatch

Different libraries use different formats. Use the conversion utilities:

```typescript
// Services: 'en-US'
// react-i18next: 'en'
// i18n-js: can use both

const shortCode = currentLanguage.split('-')[0];
```

### Getting null from getCurrentLanguage()

This means no language is stored yet. The user needs to select a language in the services UI first, or you can set a default:

```typescript
const languageCode = await oxy.getCurrentLanguage() || 'en-US';
```

## Best Practices

1. **Initialize early**: Set up language sync in your root component
2. **Handle null values**: Always provide fallbacks for when language isn't set
3. **Use metadata**: Display native language names for better UX
4. **Sync bidirectionally**: Update services when user changes language in your app
5. **Persist to server**: If user is authenticated, the language is saved to their profile automatically

## API Reference

### From `useOxy()` hook:

- `currentLanguage: string` - BCP-47 language code (e.g., 'en-US')
- `currentLanguageName: string` - English name (e.g., 'English')
- `currentNativeLanguageName: string` - Native name (e.g., 'Español')
- `currentLanguageMetadata: LanguageMetadata | null` - Full metadata object
- `setLanguage(languageId: string): Promise<void>` - Change language

### From `OxyServices` class:

- `getCurrentLanguage(prefix?: string): Promise<string | null>`
- `getCurrentLanguageName(prefix?: string): Promise<string | null>`
- `getCurrentLanguageNativeName(prefix?: string): Promise<string | null>`
- `getCurrentLanguageMetadata(prefix?: string): Promise<LanguageMetadata | null>`

### Language Utilities:

- `SUPPORTED_LANGUAGES: LanguageMetadata[]`
- `getLanguageMetadata(code: string): LanguageMetadata | null`
- `getLanguageName(code: string): string`
- `getNativeLanguageName(code: string): string`
- `normalizeLanguageCode(code: string): string`

