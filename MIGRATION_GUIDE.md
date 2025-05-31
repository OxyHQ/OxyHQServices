# Migration Guide: v5.2.x to v5.3.0

This guide helps you migrate from v5.2.x to v5.3.0 which introduces enhanced device-based session management and complete UI components.

## 🎉 Good News: No Breaking Changes!

Version 5.3.0 is fully backward compatible with v5.2.x. Your existing code will continue to work without modifications.

## 🚀 New Features You Can Adopt

### 1. Enhanced Device Session Management

#### Basic Integration (Automatic)
The enhanced device fingerprinting is automatically enabled when you use the existing login methods:

```typescript
// Your existing code works unchanged
const response = await oxyServices.secureLogin(username, password);
// Now automatically includes device fingerprinting!
```

#### Advanced Device Management (Optional)
Take advantage of new device management features:

```typescript
import { DeviceManager } from '@oxyhq/services';

// Get device information
const deviceInfo = await DeviceManager.getDeviceInfo();
console.log('Device ID:', deviceInfo.deviceId);

// Manage device sessions
const sessions = await oxyServices.getDeviceSessions(sessionId);
await oxyServices.logoutAllDeviceSessions(sessionId);
await oxyServices.updateDeviceName(sessionId, 'My Laptop');
```

### 2. New UI Components

#### Karma System Screens
```typescript
import { 
  KarmaCenterScreen,
  KarmaLeaderboardScreen,
  KarmaRewardsScreen 
} from '@oxyhq/services';

// Use in your navigation
<KarmaCenterScreen onClose={handleClose} theme="light" />
```

#### Enhanced Account Management
```typescript
import { 
  AccountSwitcherScreen,
  SessionManagementScreen 
} from '@oxyhq/services';

// Multi-account switching
<AccountSwitcherScreen onClose={handleClose} theme="light" />

// Device session management UI
<SessionManagementScreen onClose={handleClose} theme="light" />
```

#### Utility Components
```typescript
import { OxyIcon } from '@oxyhq/services';

// Standardized icons
<OxyIcon name="person" size={24} color="#333" />
```

### 3. Enhanced TypeScript Support

New type definitions are available for better development experience:

```typescript
import { 
  DeviceFingerprint, 
  StoredDeviceInfo 
} from '@oxyhq/services';

// Use the new types in your components
const handleDeviceInfo = (info: StoredDeviceInfo) => {
  console.log('Device created:', info.createdAt);
};
```

## 📱 Platform-Specific Notes

### React Native Projects
Ensure you have AsyncStorage installed for device management:

```bash
npm install @react-native-async-storage/async-storage
```

### Web Projects
Device management uses localStorage automatically - no additional setup required.

## 🔧 Configuration Updates (Optional)

### Enhanced OxyProvider Setup
Take advantage of new callback options:

```typescript
<OxyProvider
  oxyServices={oxyServices}
  theme="light"
  onAuthenticated={(user) => {
    // Now includes device session context
    console.log('User authenticated with device session');
  }}
  onAuthStateChange={(user) => {
    // Enhanced state tracking
    console.log('Auth state changed with device context');
  }}
>
  {children}
</OxyProvider>
```

### Device Session Callbacks
Monitor device session events in your app:

```typescript
// Listen for device session changes
oxyServices.on('deviceSessionsChanged', (sessions) => {
  console.log('Device sessions updated:', sessions.length);
});
```

## 🛠️ Testing Your Migration

### 1. Verify Existing Functionality
Your existing authentication should work unchanged:

```typescript
// This should work exactly as before
const response = await oxyServices.secureLogin(username, password);
```

### 2. Test New Device Features
Try the new device management features:

```typescript
// Test device fingerprinting
const fingerprint = DeviceManager.getDeviceFingerprint();
console.log('Device platform:', fingerprint.platform);

// Test device sessions
const deviceInfo = await DeviceManager.getDeviceInfo();
console.log('Device ID:', deviceInfo.deviceId);
```

### 3. Test UI Components
Try the new screens in your app:

```typescript
// Test new karma screens
import { KarmaCenterScreen } from '@oxyhq/services';

// Should render without issues
<KarmaCenterScreen 
  onClose={() => console.log('Closed')} 
  theme="light" 
/>
```

## 🚨 Troubleshooting

### Common Issues

#### 1. TypeScript Errors with New Components
**Problem**: TypeScript errors when using new components
**Solution**: Ensure you're importing from the correct path:

```typescript
// Correct
import { KarmaCenterScreen } from '@oxyhq/services';

// Or for UI-only
import { KarmaCenterScreen } from '@oxyhq/services/ui';
```

#### 2. AsyncStorage Not Found (React Native)
**Problem**: "AsyncStorage not available" error
**Solution**: Install AsyncStorage dependency:

```bash
npm install @react-native-async-storage/async-storage
```

#### 3. Device Fingerprinting Issues
**Problem**: Device fingerprinting fails in certain environments
**Solution**: The DeviceManager includes fallbacks and will gracefully handle missing APIs.

### Getting Help

If you encounter issues during migration:

1. Check the [examples](./examples/) folder for working implementations
2. Review the [CHANGELOG.md](./CHANGELOG.md) for detailed changes
3. Consult the [UI_COMPONENTS.md](./UI_COMPONENTS.md) for component documentation

## 📈 Performance Impact

The new features have minimal performance impact:

- Device fingerprinting runs once per session
- Device ID storage uses efficient local storage
- New UI components are tree-shakeable
- Bundle size increase: < 5KB gzipped

## 🎯 Recommended Upgrade Path

1. **Update the package**: `npm install @oxyhq/services@^5.3.0`
2. **Test existing functionality**: Ensure your current features work
3. **Gradually adopt new features**: Start with device management, then UI components
4. **Update TypeScript types**: Take advantage of improved type definitions
5. **Enhance user experience**: Implement new karma and session management screens

## 🔮 Future Considerations

This release sets the foundation for future enhancements:

- Enhanced multi-device synchronization
- Advanced session analytics
- Improved cross-device notifications
- Extended karma system features

Your migration to v5.3.0 positions your app to take advantage of these future features seamlessly.
