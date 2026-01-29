/**
 * Sonner Toast - Platform-Agnostic Entry Point
 *
 * Bundlers resolve platform-specific implementations:
 * - Metro (React Native): resolves to sonner.native.ts
 * - Vite/Webpack (Web): resolves to sonner.web.ts
 * - Node.js/SSR: uses this file (web fallback)
 *
 * This file exports web as the default for /core and /web entry points.
 */
export { toast, Toaster, type ToastT } from './sonner.web';
