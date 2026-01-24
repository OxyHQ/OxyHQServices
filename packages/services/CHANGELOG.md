# Changelog

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
