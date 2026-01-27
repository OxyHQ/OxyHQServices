# Changelog

## [5.22.0] - 2026-01-27

### Added
- **New `/web` entry point** (`@oxyhq/services/web`) for pure React/Next.js/Vite apps
  - Optimized for web-only applications without Expo or React Native
  - Excludes all React Native dependencies for smaller bundle size
  - No bundler configuration needed (no react-native-web required)
  - Exports `WebOxyProvider` and all web-compatible features
  - Recommended for all pure web applications

### Changed
- Updated package.json exports to properly support all platforms:
  - **Expo 54 (native)**: Uses source files via `react-native` condition
  - **Expo 54 (web)**: Uses pre-built files with react-native-web
  - **Pure React web**: Use `/web` entry point (no RN deps) or main entry with bundler config
  - **Node.js**: Uses core-only build via `node` condition
- Improved TypeScript type exports for better IDE support

### Documentation
- Added comprehensive platform usage guide in README
- Added web bundler configuration section (Vite, Webpack, Next.js)
- Documented when to use each entry point
- Added examples for all supported platforms

### Migration Guide
For pure web apps (Vite, Next.js, CRA), switch to the new `/web` entry point:

```typescript
// Before (requires bundler config)
import { WebOxyProvider } from '@oxyhq/services';

// After (cleaner, no config needed)
import { WebOxyProvider } from '@oxyhq/services/web';
```

No changes needed for Expo apps or Node.js backends - they continue to work as before.

## [Unreleased]

### Changed
- **BREAKING**: Migrated from Phudu to Inter as the default font family for the entire Oxy ecosystem
  - Inter font is now included and automatically loaded
  - All font references updated to use Inter
  - Apps using this package will automatically get Inter fonts
  - See [FONTS.md](./FONTS.md) for complete typography guide

### Added
- Added comprehensive typography documentation ([FONTS.md](./FONTS.md))
- Exported `fontFamilies` and `fontStyles` constants for consistent font usage
- Exported `FontLoader` component and `setupFonts()` function
- Added 7 Inter font weights: Light (300), Regular (400), Medium (500), SemiBold (600), Bold (700), ExtraBold (800), Black (900)

### Removed
- Removed Phudu font family and all related files
- Removed hardcoded platform-specific font checks in favor of centralized constants

### Migration Guide
If you were using the Phudu fonts from this package:

1. Replace all `fontFamilies.phudu*` with `fontFamilies.inter*`:
   ```typescript
   // Before
   fontFamily: fontFamilies.phuduBold
   
   // After
   fontFamily: fontFamilies.interBold
   ```

2. The `fontStyles` constants remain the same (already updated to Inter)

3. No other changes required - Inter fonts load automatically via `FontLoader`

See [FONTS.md](./FONTS.md) for complete documentation.
