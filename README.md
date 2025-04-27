# Oxy Services Module

A unified client library for the Oxy API (authentication, user management, notifications, payments, analytics, wallet, and karma).

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [API Reference](#api-reference)
  - [OxyConfig](#oxyconfig)
  - [Class: OxyServices](#class-oxyservices)
- [Examples](#examples)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

The `@oxyhq/services` package provides a simple, promise-based client to interact with the Oxy API. It wraps HTTP calls to endpoints for:

- Authentication (signup, login, token refresh, logout, validation)
- User & profile operations (fetch, update, follow/unfollow)
- Real‑time notifications (list, create, mark read, delete)
- Payments & wallet (process payment, validate method, transfer funds, purchase, withdrawal)
- Analytics & content insights (time‑series data, viewers, follower stats)
- Karma system (leaderboard, rules, award/deduct points)

This library is framework-agnostic and works in Node.js, browser, and React Native environments.

## Installation

```bash
npm install @oxyhq/services axios jwt-decode
```

> **Peer Dependencies**: React, React Native, and optional storage libraries if used in mobile apps.

## Usage

```typescript
import OxyServices, { OxyConfig } from '@oxyhq/services';

const config: OxyConfig = { baseURL: 'https://api.mention.earth' };
const client = new OxyServices(config);

// Authenticate and start using API
(async () => {
  const login = await client.login('alice', 'Secret123!');
  console.log('Logged in user:', login.user);
  const profile = await client.getProfileByUsername('bob');
  console.log('Bob’s profile:', profile);
})();
```

## Configuration

`OxyConfig`:

```ts
interface OxyConfig {
  /** Base URL of the Oxy API, e.g. https://api.mention.earth */
  baseURL: string;
  /** Optional timeout in milliseconds (default: 0 for no timeout) */
  timeout?: number;
}
```

- Requests use `axios` under the hood. You can set `timeout` or other axios defaults via config or by accessing `client.client.defaults`.
- Tokens are stored in-memory; for persistence (e.g. React Native storage), handle saving and restoring external to this library.

## API Reference

### OxyConfig

| Property | Type      | Required | Description                           |
| -------- | --------- | -------- | ------------------------------------- |
| baseURL  | `string`  | Yes      | Root URL of the Oxy API server        |
| timeout  | `number`  | No       | Request timeout in milliseconds       |

### Class: OxyServices

Instantiate with:
```ts
const client = new OxyServices(config);
```

#### Authentication

| Method               | Signature                                                   | Description                                    |
| -------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `signUp`             | `(username: string, email: string, password: string) => Promise<{ message: string; token: string; user: User }>` | Create a new user and receive a token         |
| `login`              | `(username: string, password: string) => Promise<LoginResponse>` | Authenticate and store access & refresh tokens |
| `logout`             | `() => Promise<void>`                                       | Revoke current refresh token                   |
| `refreshTokens`      | `() => Promise<{ accessToken: string; refreshToken: string }>` | Obtain new tokens using stored refresh token   |
| `validate`           | `() => Promise<boolean>`                                     | Check if current access token is valid         |

#### User & Profiles

| Method                       | Signature                                       | Description                                                                |
| ---------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| `getProfileByUsername`       | `(username: string) => Promise<any>`            | Fetch public profile by username                                           |
| `searchProfiles`             | `(query: string, limit?: number, offset?: number) => Promise<any[]>` | Full-text search for profiles                     |
| `getUserById`                | `(userId: string) => Promise<any>`              | Fetch user data by user ID                                                  |
| `updateUser`                 | `(userId: string, updates: Record<string, any>) => Promise<any>` | Update fields on authenticated user profile                                  |
| `followUser` / `unfollowUser`| `(userId: string) => Promise<any>`              | Toggle following relationship with target user                              |

#### Notifications

| Method                          | Signature                                 | Description                               |
| ------------------------------- | ----------------------------------------- | ----------------------------------------- |
| `getNotifications`              | `() => Promise<Notification[]>`           | Retrieve all notifications for current user|
| `getUnreadCount`                | `() => Promise<number>`                   | Count unread notifications                |
| `createNotification`            | `(data: Partial<Notification>) => Promise<Notification>` | (Admin) create custom notification         |
| `markNotificationAsRead`        | `(id: string) => Promise<void>`           | Mark one notification as read              |
| `markAllNotificationsAsRead`    | `() => Promise<void>`                     | Mark all notifications as read             |
| `deleteNotification`            | `(id: string) => Promise<void>`           | Delete a notification                      |

#### Payments & Wallet

| Method                   | Signature                                                       | Description                              |
| ------------------------ | --------------------------------------------------------------- | ---------------------------------------- |
| `processPayment`         | `(data: { userId: string; plan: string; paymentMethod: any; platform: string }) => Promise<{ success: boolean; transactionId: string }>` | Charge user for subscription or plan       |
| `validatePaymentMethod`  | `(paymentMethod: any) => Promise<{ valid: boolean }>`            | Pre-validate payment method               |
| `getPaymentMethods`      | `(userId: string) => Promise<any>`                              | List saved payment methods                |
| `getWallet`              | `(userId: string) => Promise<any>`                              | Fetch or initialize wallet balance        |
| `getTransactionHistory`  | `(userId: string, limit?: number, offset?: number) => Promise<any>` | Retrieve paginated transaction history     |
| `getTransaction`         | `(transactionId: string) => Promise<any>`                       | Fetch details for a specific transaction  |
| `transferFunds`          | `(data: { fromUserId: string; toUserId: string; amount: number; description?: string }) => Promise<any>` | Transfer funds between users                |
| `processPurchase`        | `(data: { userId: string; amount: number; itemId: string; itemType: string; description?: string }) => Promise<any>` | Debit wallet for an in‑app purchase         |
| `requestWithdrawal`      | `(data: { userId: string; amount: number; address: string }) => Promise<any>` | Initiate a withdrawal request               |

#### Analytics

| Method                   | Signature                                                      | Description                               |
| ------------------------ | -------------------------------------------------------------- | ----------------------------------------- |
| `getAnalytics`           | `(userId: string, period?: string) => Promise<any>`            | Time‑series metrics for a user            |
| `updateAnalytics`        | `(userId: string, type: string, data: Record<string, any>) => Promise<{ message: string }>` | Increment analytics counters               |
| `getContentViewers`      | `(userId: string, period?: string) => Promise<any[]>`          | List viewers of user content               |
| `getFollowerDetails`     | `(userId: string, period?: string) => Promise<any>`            | Insights on follower growth                |

#### Karma System

| Method                      | Signature                                                   | Description                                   |
| --------------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| `getKarmaLeaderboard`       | `() => Promise<any[]>`                                      | Global leaderboard of top karma earners       |
| `getKarmaRules`             | `() => Promise<any[]>`                                      | List configured karma rules                   |
| `getUserKarmaTotal`         | `(userId: string) => Promise<{ total: number }>`            | Fetch total karma for a user                  |
| `getUserKarmaHistory`       | `(userId: string, limit?: number, offset?: number) => Promise<any>` | User’s karma event history                     |
| `awardKarma` / `deductKarma`| `(data: { userId: string; points: number; reason?: string }) => Promise<any>` | Modify user karma (requires auth)            |
| `createOrUpdateKarmaRule`   | `(data: any) => Promise<any>`                                | (Admin) define or update karma rules         |

## Examples

See usage in the [Fast Start](#usage) section above. For advanced scenarios (e.g., external token storage, Axios customization), refer to source code: `src/index.ts`.

## Development

```bash
# Install dev deps
tonpm install
# Build library
npm run build
# Run tests (no tests by default)
npm test
``` 

## Contributing

1. Fork the repo
2. Create feature branch
3. Code and add tests
4. Build and commit
5. Open PR for review

## License

MIT © Oxy