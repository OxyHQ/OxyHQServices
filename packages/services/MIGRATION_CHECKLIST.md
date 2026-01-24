# Inter Font Migration Checklist

Use this checklist when migrating apps to use the new Inter font from @oxyhq/services.

## For New Apps

- [ ] Install latest `@oxyhq/services` package
- [ ] Wrap app with `<FontLoader>` component
- [ ] Use `fontFamilies` constants for all custom fonts
- [ ] Use `fontStyles` for common text patterns
- [ ] Test on iOS, Android, and Web

**You're done!** Inter fonts load automatically.

## For Existing Apps (Using Phudu)

### 1. Update Dependencies
- [ ] Update `@oxyhq/services` to latest version
- [ ] Run `npm install` or `yarn install`

### 2. Update Font References

Replace all Phudu font references with Inter:

```bash
# Quick find and replace (run in your app directory)
find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -exec sed -i 's/fontFamilies\.phudu\b/fontFamilies.inter/g' {} +
  
find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -exec sed -i 's/fontFamilies\.phuduLight/fontFamilies.interLight/g' {} +
  
find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -exec sed -i 's/fontFamilies\.phuduMedium/fontFamilies.interMedium/g' {} +
  
find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -exec sed -i 's/fontFamilies\.phuduSemiBold/fontFamilies.interSemiBold/g' {} +
  
find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -exec sed -i 's/fontFamilies\.phuduBold/fontFamilies.interBold/g' {} +
  
find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -exec sed -i 's/fontFamilies\.phuduExtraBold/fontFamilies.interExtraBold/g' {} +
  
find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -exec sed -i 's/fontFamilies\.phuduBlack/fontFamilies.interBlack/g' {} +
```

### 3. Update Direct Font References

Replace any hardcoded font family strings:

- [ ] Replace `'Phudu'` with `fontFamilies.inter`
- [ ] Replace `'Phudu-Light'` with `fontFamilies.interLight`
- [ ] Replace `'Phudu-Medium'` with `fontFamilies.interMedium`
- [ ] Replace `'Phudu-SemiBold'` with `fontFamilies.interSemiBold`
- [ ] Replace `'Phudu-Bold'` with `fontFamilies.interBold`
- [ ] Replace `'Phudu-ExtraBold'` with `fontFamilies.interExtraBold`
- [ ] Replace `'Phudu-Black'` with `fontFamilies.interBlack`

### 4. Remove Local Phudu Files (if any)

- [ ] Delete local Phudu font files
- [ ] Remove Phudu from `react-native.config.js` (if present)
- [ ] Remove Phudu from `app.json` fonts array (if present)

### 5. Verify Changes

```bash
# Check for remaining Phudu references
grep -r "phudu" . --include="*.ts" --include="*.tsx"

# Should return 0 results
```

### 6. Test Build

- [ ] Run TypeScript build: `npm run build` or `tsc`
- [ ] Fix any TypeScript errors
- [ ] Verify no font-related warnings

### 7. Visual Testing

- [ ] Test on iOS device/simulator
- [ ] Test on Android device/emulator
- [ ] Test on Web browser
- [ ] Compare with design mockups
- [ ] Check all font weights render correctly
- [ ] Verify text is readable at all sizes

### 8. Platform-Specific Testing

#### iOS
- [ ] Check bold text renders correctly
- [ ] Verify font spacing and kerning
- [ ] Test on different iOS versions (14+)

#### Android
- [ ] Check font rendering on different Android versions
- [ ] Verify font padding is correct
- [ ] Test on different screen densities

#### Web
- [ ] Verify fonts load in Chrome
- [ ] Verify fonts load in Safari
- [ ] Verify fonts load in Firefox
- [ ] Check font-weight CSS applies correctly

### 9. Performance Check

- [ ] Fonts load without blocking render
- [ ] No flash of unstyled text (FOUT)
- [ ] Bundle size is reasonable
- [ ] No console warnings about fonts

### 10. Commit and Deploy

- [ ] Commit font migration changes
- [ ] Update changelog
- [ ] Create pull request
- [ ] Get code review
- [ ] Merge to main
- [ ] Deploy to staging
- [ ] Test in staging environment
- [ ] Deploy to production

## Common Issues

### TypeScript Errors

**Error:** `Property 'phudu*' does not exist`

**Fix:** You missed updating some font references. Run the find and replace commands again.

### Fonts Not Loading

**Error:** Fonts appear as system default

**Fix:** 
1. Ensure `<FontLoader>` wraps your app
2. Check `fontFamilies` import is from `@oxyhq/services`
3. Rebuild the app

### Different Appearance on Platforms

**Expected:** Fonts may render slightly differently on iOS vs Android vs Web. This is normal.

**Fix:** If significantly different, check that:
- You're using the correct weight (`interBold` not `interSemiBold`)
- `fontWeight` is not applied on native (only on web)

## Resources

- [FONTS.md](FONTS.md) - Complete typography guide
- [README.md](README.md) - Package documentation
- [CHANGELOG.md](CHANGELOG.md) - Migration notes

## Need Help?

- Check [FONTS.md](FONTS.md) for troubleshooting
- Review example code in documentation
- Report issues: https://github.com/oxyhq/services/issues
