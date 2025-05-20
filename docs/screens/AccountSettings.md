# Account Settings Screen

The Account Settings screen provides users with the ability to manage their profile information, security settings, and notification preferences.

## Overview

This screen is accessible from the Account Center and includes three main sections:
- Profile: Edit personal details and avatar
- Password: Change account password
- Notifications: Manage notification preferences

## Usage

```tsx
import { AccountSettingsScreen } from '@oxyhq/services';

// Use directly in component hierarchy
<AccountSettingsScreen
  goBack={() => {}}
  theme="light"
  activeTab="profile"
/>

// Or navigate to it via OxyRouter
navigate('AccountSettings');

// Navigate directly to a specific tab
navigate('AccountSettings', { activeTab: 'password' });
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| activeTab | `'profile' \| 'password' \| 'notifications'` | `'profile'` | Initial active tab |
| theme | `'light' \| 'dark'` | `'light'` | Theme to use for styling |
| goBack | `() => void` | | Function to call when the back button is pressed |

## Features

### Profile Tab
- Update username
- Update email address
- Edit bio/about information
- Change profile avatar

### Password Tab
- Change password with current password verification
- Password strength validation

### Notifications Tab
- Toggle email notifications
- Toggle push notifications

## API Integration

This screen uses the following OxyServices methods:
- `updateUser`: Updates user profile information including avatar, username, email, and bio
- `updateUser`: Updates user password with verification
- `updateUser`: Updates notification preferences

## Related Components

- [AccountCenterScreen](./AccountCenter.md): Main account management screen
- [ProfileScreen](./Profile.md): Public profile view