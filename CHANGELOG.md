# Changelog

## Bug Fixes and Code Quality Improvements

### 🔧 Build System Fixes

**API Package:**
- ✅ Fixed TypeScript compilation errors by updating @types/node and removing deprecated packages
- ✅ Removed deprecated `csurf` package (security vulnerability)
- ✅ Updated `multer` from vulnerable v1.4.5 to secure v2.0.0
- ✅ Fixed MongoDB GridFS compatibility issues with proper ObjectId imports
- ✅ Resolved TypeScript configuration issues

**Services Package:**
- ✅ Added proper fallback handling for optional peer dependencies
- ✅ Created wrapper components for @expo/vector-icons and @gorhom/bottom-sheet
- ✅ Fixed JSX compilation issues in lib files
- ✅ Added proper TypeScript type definitions for optional dependencies
- ✅ Fixed global vs globalThis usage for cross-platform compatibility
- ✅ Created missing sonner toast utility module
- ✅ Excluded test files from main build to prevent type conflicts

### 🔒 Security Improvements

- ✅ Removed deprecated `csurf` package (archived and vulnerable)
- ✅ Updated `multer` to address known security vulnerabilities
- ✅ Reduced npm audit vulnerabilities from 7 to 5 (remaining are dev dependencies)

### 📚 Documentation Updates

- ✅ Enhanced README files with troubleshooting sections
- ✅ Added information about optional dependencies and fallbacks
- ✅ Updated Node.js version requirements to 18+
- ✅ Added proper build instructions and linting commands

### 🎯 Code Quality

- ✅ Both packages now build successfully without errors
- ✅ Added @biomejs/biome linter for better code quality
- ✅ Improved TypeScript configuration for better type safety
- ✅ Added proper peer dependency configuration

### 🔄 Compatibility Improvements

- ✅ Enhanced cross-platform compatibility (React Native, Web, Node.js)
- ✅ Graceful degradation when optional dependencies are missing
- ✅ Better fallback components for missing peer dependencies