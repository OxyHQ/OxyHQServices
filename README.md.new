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

## What's New in 5.1.5

- **Fixed BottomSheet on Native Platforms**: The `OxyProvider` component now correctly displays the authentication UI in a bottom sheet on native platforms.
- **Added `bottomSheetRef` Prop**: The `OxyProvider` component now accepts a `bottomSheetRef` prop for programmatic control of the bottom sheet.
- **Improved Native Animations**: Enhanced animation and layout behavior for a smoother experience on all platforms.

## Installation

```bash
# npm
npm install @oxyhq/services

# yarn
yarn add @oxyhq/services
```

### Required Peer Dependencies

For React Native applications using the bottom sheet authentication UI:

```bash
# npm
npm install @gorhom/bottom-sheet react-native-gesture-handler react-native-reanimated react-native-safe-area-context

# yarn
yarn add @gorhom/bottom-sheet react-native-gesture-handler react-native-reanimated react-native-safe-area-context
```
