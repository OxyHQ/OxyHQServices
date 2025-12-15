/**
 * Auth Layout (Web Fallback)
 * 
 * This route is only available on native platforms (iOS/Android).
 * On web, this route should not be accessible (excluded from Stack in root layout).
 * This file exists as a fallback for direct URL access.
 */
export default function AuthLayout() {
  // Route is excluded from Stack on web, so this should never render
  // But if it does (e.g., direct URL access), return null
  return null;
}

