# Migration Guide - OxyHQ Services v5.5.0

## 🚀 Overview

OxyHQ Services has been updated to v5.5.0 with improved API compatibility, better error handling, and enhanced performance. This guide will help you migrate from previous versions to the latest release.

## ✨ Key Improvements

### 🔄 Standardized API Response Format
The services package now supports the new standardized API response format:
```typescript
{
  success: boolean;
  data?: any;
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}
```

### 🛡️ Enhanced Error Handling
- Better error classification with standardized error codes
- Improved error messages with more context
- Automatic token refresh on expiration
- Graceful handling of network errors

### 🔐 Improved Authentication
- Better JWT token management
- Automatic token refresh before expiration
- Enhanced session management
- Device fingerprinting support

### 📡 Updated API Endpoints
Several endpoints have been updated to match the improved API structure:

| Old Endpoint | New Endpoint | Method | Notes |
|--------------|--------------|--------|-------|
| `/users/profile` | `/users/me` | GET | Get current user |
| `/users/profile` | `/users/me` | PUT | Update current user |
| `/users/search?q=query` | `/users/search` | POST | Search users |
| `/users/follow/{id}` | `/users/{id}/follow` | POST | Follow user |
| `/users/follow/{id}` | `/users/{id}/follow` | DELETE | Unfollow user |

## 🔧 Breaking Changes

### 1. Response Format Changes

**Before:**
```typescript
const user = await oxy.getCurrentUser();
// user was the direct response
```

**After:**
```typescript
const user = await oxy.getCurrentUser();
// user is now extracted from response.data automatically
```

### 2. Error Handling

**Before:**
```typescript
try {
  const result = await oxy.someMethod();
} catch (error) {
  console.error(error.message);
}
```

**After:**
```typescript
try {
  const result = await oxy.someMethod();
} catch (error) {
  // error now has standardized format
  console.error(error.code, error.message, error.details);
}
```

### 3. Search Methods

**Before:**
```typescript
const users = await oxy.searchProfiles('query', 10, 0);
// Used GET request with query parameters
```

**After:**
```typescript
const users = await oxy.searchProfiles('query', 10, 0);
// Now uses POST request with body parameters
```

## 📝 Migration Steps

### Step 1: Update Package Version

```bash
npm install @oxyhq/services@5.5.0
# or
yarn add @oxyhq/services@5.5.0
```

### Step 2: Update Import Statements

**Before:**
```typescript
import { OxyServices } from '@oxyhq/services';
```

**After:**
```typescript
import OxyServices from '@oxyhq/services';
// or for custom instances
import { OxyServices } from '@oxyhq/services/core';
```

### Step 3: Update Error Handling

**Before:**
```typescript
try {
  const user = await oxy.getCurrentUser();
} catch (error: any) {
  if (error.response?.status === 401) {
    // Handle unauthorized
  }
}
```

**After:**
```typescript
try {
  const user = await oxy.getCurrentUser();
} catch (error: any) {
  if (error.code === 'INVALID_TOKEN' || error.status === 401) {
    // Handle unauthorized
  }
}
```

### Step 4: Update Authentication Flow

**Before:**
```typescript
const loginResult = await oxy.login('username', 'password');
oxy.setTokens(loginResult.accessToken, loginResult.refreshToken);
```

**After:**
```typescript
const loginResult = await oxy.login('username', 'password');
// Tokens are automatically set by the service
// No need to manually call setTokens
```

### Step 5: Update Search Methods

**Before:**
```typescript
const user = await oxy.getProfileByUsername('username');
// Used GET request
```

**After:**
```typescript
const user = await oxy.getProfileByUsername('username');
// Now uses POST request internally
```

## 🔄 Backward Compatibility

The services package maintains backward compatibility for most methods. The following changes are automatically handled:

- **Response Format**: Old response formats are automatically converted
- **Token Management**: Both old and new token formats are supported
- **Error Handling**: Old error formats are converted to new format
- **Endpoint Changes**: Internal endpoint changes are transparent to users

## 🧪 Testing Your Migration

Create a test script to verify your migration:

```typescript
import OxyServices from '@oxyhq/services';

const oxy = new OxyServices({
  baseURL: 'https://api.oxy.so'
});

async function testMigration() {
  try {
    // Test basic functionality
    const usernameCheck = await oxy.checkUsernameAvailability('testuser');
    console.log('Username check:', usernameCheck);
    
    // Test search functionality
    const searchResults = await oxy.searchProfiles('test');
    console.log('Search results:', searchResults.length);
    
    // Test error handling
    try {
      await oxy.getCurrentUser(); // Should fail without auth
    } catch (error) {
      console.log('Expected error:', error.code);
    }
    
    console.log('✅ Migration successful!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

testMigration();
```

## 🐛 Common Issues

### Issue 1: "Cannot find module" errors
**Solution:** Make sure you're using the correct import syntax:
```typescript
// ✅ Correct
import OxyServices from '@oxyhq/services';

// ❌ Incorrect
import { OxyServices } from '@oxyhq/services';
```

### Issue 2: Authentication errors
**Solution:** Ensure you're setting the correct base URL:
```typescript
const oxy = new OxyServices({
  baseURL: 'https://api.oxy.so' // Use your actual API URL
});
```

### Issue 3: Search not working
**Solution:** The search method now uses POST instead of GET:
```typescript
// ✅ Correct - uses POST internally
const users = await oxy.searchProfiles('query');

// ❌ Don't try to use GET directly
```

## 📚 Additional Resources

- [API Documentation](https://docs.oxy.so)
- [GitHub Repository](https://github.com/oxyhq/oxyhqservices)
- [Issue Tracker](https://github.com/oxyhq/oxyhqservices/issues)

## 🤝 Support

If you encounter any issues during migration:

1. Check this migration guide
2. Review the [API documentation](https://docs.oxy.so)
3. Search existing [issues](https://github.com/oxyhq/oxyhqservices/issues)
4. Create a new issue with detailed information

## 🎉 What's New in v5.5.0

- ✨ **Improved API Compatibility**: Works seamlessly with the enhanced API
- 🔄 **Standardized Responses**: Support for new API response format
- 🛡️ **Better Error Handling**: More informative error messages
- 🔐 **Enhanced Security**: Improved token management and validation
- 📡 **Updated Endpoints**: Aligned with latest API structure
- 🧹 **Code Cleanup**: Better organization and documentation
- 🔧 **Backward Compatibility**: Minimal breaking changes

---

**Happy coding! 🚀** 