# Migration Guide: Refactored Crypto Architecture

## Overview

The Oxy codebase has been refactored to eliminate duplication between the Services SDK and API backend. This guide helps you understand what changed and how to adapt if needed.

## What Changed?

### 1. Shared Crypto Core Module

**Before:**
- Services SDK had `signatureService.ts` with async methods
- API had separate `signature.service.ts` with sync methods
- Duplicate logic for signature verification, key validation, etc.

**After:**
- New `packages/services/src/crypto/core.ts` contains shared logic
- Both Services and API use this core module
- API's `signature.service.ts` now re-exports from `@oxyhq/services/node`

### 2. Removed Legacy Endpoints

The following deprecated endpoints have been removed:
- `POST /auth/signup` - Was returning 410 error
- `POST /auth/login` - Was returning 400 error

These were already non-functional. Use the challenge-response flow instead:
1. `POST /auth/register` - Register with public key
2. `POST /auth/challenge` - Request challenge
3. `POST /auth/verify` - Verify signed challenge

### 3. Package Dependencies

The API now depends on `@oxyhq/services` as a workspace dependency:

```json
{
  "dependencies": {
    "@oxyhq/services": "workspace:*"
  }
}
```

## Migration Steps

### For API Backend Developers

If you're importing SignatureService in the API:

**Before:**
```typescript
import SignatureService from '../services/signature.service';
```

**After:**
```typescript
// Direct import from shared module (professional approach)
import { SignatureService } from '@oxyhq/services/node';
```

The signature.service.ts file has been removed from the API package. All imports now directly use the shared module from @oxyhq/services/node. This eliminates the unnecessary re-export layer and provides a more direct, professional implementation.

The API surface is identical:
- `SignatureService.generateChallenge()`
- `SignatureService.verifyChallengeResponse(publicKey, challenge, signature, timestamp)`
- `SignatureService.verifyRegistrationSignature(publicKey, signature, timestamp)`
- `SignatureService.isValidPublicKey(publicKey)`
- `SignatureService.shortenPublicKey(publicKey)`

### For Services SDK Users

No changes needed! The public API remains the same:

```typescript
import { SignatureService } from '@oxyhq/services/crypto';

// Async methods still work
await SignatureService.sign(message);
await SignatureService.verify(message, signature, publicKey);
```

### For Monorepo Maintainers

When installing dependencies:

```bash
# Install all workspace dependencies
npm install

# Or for API specifically
cd packages/api
npm install
```

The workspace dependency will be resolved automatically by npm.

## Benefits of This Change

### 1. Single Source of Truth
- Crypto logic is defined once in `core.ts`
- Changes automatically propagate to both frontend and backend
- Impossible for implementations to drift apart

### 2. Easier Testing
- Test the core module once
- Both platforms benefit from the tests
- New test file: `packages/services/src/crypto/__tests__/core.test.ts`

### 3. Consistent Message Formats
All message building uses shared functions:
- `buildAuthMessage(publicKey, challenge, timestamp)`
- `buildRegistrationMessage(publicKey, timestamp)`
- `buildRequestMessage(publicKey, timestamp, data)`

This ensures signatures created on mobile can be verified on the server.

### 4. Better Documentation
- New `packages/services/src/crypto/README.md` explains architecture
- Clear separation between Accounts app and third-party apps
- Security best practices documented

## Troubleshooting

### Issue: "Cannot find module '@oxyhq/services/node'"

**Solution:** Make sure you've installed dependencies in the monorepo root:
```bash
cd /path/to/OxyHQServices
npm install
```

### Issue: Build errors in API

**Solution:** Ensure the services package is built first:
```bash
cd packages/services
npm run build
```

### Issue: Type errors with SignatureService

**Solution:** The API is identical. If you see type errors:
1. Check that `@oxyhq/services` is in `package.json`
2. Restart your TypeScript server / IDE
3. Clear any build caches

## Testing Your Changes

### Run Crypto Core Tests
```bash
cd packages/services
npm test -- src/crypto/__tests__/core.test.ts
```

### Verify Signature Compatibility
Create a test that signs on one platform and verifies on another:

```typescript
// On mobile/React Native
import { SignatureService } from '@oxyhq/services/crypto';
const signature = await SignatureService.sign(message);

// On backend/Node.js
import { SignatureService } from '@oxyhq/services/node';
const isValid = SignatureService.verifySignature(message, signature, publicKey);
```

Both should work seamlessly.

## Future Improvements

The following improvements are planned but not yet implemented:

### 1. AES-GCM Backup Encryption
Currently, identity backups use a custom XOR scheme. This will be replaced with standard AES-256-GCM encryption for better security and compatibility.

**Location:** `packages/accounts/components/identity/EncryptedBackupGenerator.tsx`

**Tracking:** TODO comments in the code

### 2. Hardware-Backed Key Storage
Future versions may use hardware security modules when available (iOS Secure Enclave, Android StrongBox).

### 3. Key Rotation Support
Design the system to handle multiple public keys per user for key rotation scenarios.

## Questions?

For issues or questions about this refactoring:
1. Check the crypto module README: `packages/services/src/crypto/README.md`
2. Review the main architecture docs: `README.md`
3. Open an issue on GitHub

## Rollback (If Needed)

If you need to rollback this change:

1. Revert commits:
   ```bash
   git revert <commit-hash>
   ```

2. The old `signature.service.ts` can be restored from git history

3. Remove `@oxyhq/services` from API dependencies

Note: Rollback should not be necessary - the API surface is unchanged.
