# Oxy Crypto Module

This module provides cryptographic operations for the Oxy ecosystem, supporting both React Native and Node.js environments.

## Architecture

The crypto module is organized into several layers:

### Core Layer (`core.ts`)
Platform-agnostic cryptographic functions that work everywhere:
- Signature verification using elliptic curve cryptography
- Public/private key validation
- Message formatting (auth, registration, requests)
- Utility functions (shortenPublicKey, derivePublicKey, etc.)

### Platform-Specific Implementations

#### React Native (`signatureService.ts`, `keyManager.ts`)
- **KeyManager**: Manages ECDSA key pairs with secure storage via Expo SecureStore
  - ⚠️ **For Oxy Accounts app only** - Not intended for third-party apps
  - Handles key generation, import, backup, and secure retrieval
  - Private keys never leave the device

- **SignatureService**: Provides async signing and verification
  - Uses `expo-crypto` for hashing in React Native
  - Falls back to Node.js crypto when available
  - Suitable for both React Native and Node.js environments

#### Node.js (`node/signatureService.ts`)
- Optimized synchronous signature operations for backend
- Uses Node's `crypto` module directly for better performance
- Exports same API as React Native version for consistency

## Usage

### In React Native / Accounts App

```typescript
import { KeyManager, SignatureService } from '@oxyhq/services/crypto';

// Create identity (Accounts app only)
const publicKey = await KeyManager.createIdentity();

// Sign a challenge
const signature = await SignatureService.sign(message);

// Verify a signature
const isValid = await SignatureService.verify(message, signature, publicKey);
```

### In Node.js Backend

```typescript
import { SignatureService } from '@oxyhq/services/node';

// Generate challenge
const challenge = SignatureService.generateChallenge();

// Verify signature (synchronous)
const isValid = SignatureService.verifyChallengeResponse(
  publicKey,
  challenge,
  signature,
  timestamp
);
```

### In Third-Party Apps (Services SDK)

Third-party apps should **not** use KeyManager directly. Instead, use the authentication flows provided by the OxyServices class:

```typescript
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

// Request authentication (shows QR code / deep link)
// User approves in Oxy Accounts app
// Returns session when approved
const session = await oxy.requestAuth({ appId: 'my-app' });
```

## Security Considerations

### Message Formats
All signed messages follow specific formats to prevent replay attacks:

- **Authentication**: `auth:{publicKey}:{challenge}:{timestamp}`
- **Registration**: `oxy:register:{publicKey}:{timestamp}`
- **API Requests**: `request:{publicKey}:{timestamp}:{canonicalData}`

Timestamps must be within 5 minutes to be valid.

### Key Storage
- Private keys are stored in device secure storage (iOS Keychain, Android Keystore)
- Never transmitted or exposed outside the device
- Only the Oxy Accounts app has access to private keys

### Backup Encryption
⚠️ **Current Implementation**: The backup encryption currently uses a custom XOR scheme with key stretching. This is functional but not optimal.

📋 **Planned Improvement**: Migrate to standard AES-256-GCM encryption for better security and interoperability.

## Separation of Concerns

### Oxy Accounts App
- Owns and manages the user's private key
- Handles identity creation, backup, and recovery
- Signs authentication challenges
- Uses `KeyManager` and `SignatureService`

### Services SDK / Third-Party Apps
- Does NOT generate or store private keys
- Displays QR codes and deep links for authentication
- Polls server for authentication status
- Uses `OxyServices` class for API communication

### API Backend
- Generates challenges
- Verifies signatures using public keys
- Manages sessions and user data
- Uses `SignatureService` from `@oxyhq/services/node`

## Migration from Old Signature Service

The API previously had a duplicate `signature.service.ts` file. This has been replaced with a re-export from `@oxyhq/services/node` to ensure consistency and eliminate duplication.

If you're maintaining code that imports from the old location, it will continue to work as the file now re-exports from the shared module.

## Testing

When making changes to crypto code:
1. Test in both React Native and Node.js environments
2. Verify signatures created in one environment can be verified in another
3. Check that timestamps are properly validated
4. Ensure message formats match exactly between client and server

## Further Reading

- [Public Key Authentication Guide](../docs/PUBLIC_KEY_AUTHENTICATION.md)
- [ECDSA on secp256k1](https://en.bitcoin.it/wiki/Secp256k1)
- [Expo SecureStore Documentation](https://docs.expo.dev/versions/latest/sdk/securestore/)
