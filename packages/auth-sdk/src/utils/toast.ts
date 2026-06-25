/**
 * Internal toast wrapper — keeps `sonner` a TRULY optional peer dependency.
 *
 * # Why this exists
 *
 * `sonner` is declared in `package.json` as an OPTIONAL peer
 * (`peerDependenciesMeta.sonner.optional = true`, not a hard dependency).
 * Several hooks want to surface user-facing toasts when the consumer app has
 * `sonner` installed, but a STATIC `import { toast } from 'sonner'` makes
 * bundlers (Vite / Rolldown) try to resolve the optional peer at build time.
 * For a web consumer WITHOUT `sonner`, that produces a hard build failure:
 *
 *   "toast" is not exported by "__vite-optional-peer-dep:sonner:@oxyhq/auth"
 *
 * tsc does NOT catch this — it only manifests in the consumer's bundler. The
 * fix is to never statically reference `sonner`. Instead we lazily resolve it
 * via a dynamic `import()` whose specifier is hidden behind a variable so no
 * bundler can statically resolve (or fail on) the missing optional peer.
 *
 * # Dual CJS + ESM constraint
 *
 * `@oxyhq/auth` ships dual CJS + ESM, and the ESM build MUST NOT contain any
 * CommonJS-style synchronous module loading (Vite/Rolldown ESM consumers crash
 * on it). A real `import(...)` expression satisfies both:
 *   - ESM build (`module: ESNext`)   → preserved as native dynamic `import()`,
 *                                      no CommonJS loader call.
 *   - CJS build (`module: CommonJS`) → tsc downlevels it to the CommonJS loader
 *                                      form, which is fine inside the CJS output.
 * This mirrors the established `await import(...)` pattern in
 * `@oxyhq/core` (`platformCrypto.ts`).
 *
 * # Behavior
 *
 * The dynamic import is fired once (fire-and-forget) the first time any toast
 * method is invoked. While it resolves, calls no-op. Once resolved, the real
 * `sonner.toast` is cached and used for all subsequent calls. If `sonner` is
 * not installed, the import rejects and every method permanently no-ops (with a
 * one-time dev warning). UI toasts are non-critical, so a missed first call
 * before the lazy import settles is an acceptable trade-off for keeping the
 * peer optional and the build clean for consumers without `sonner`.
 */

import { logger } from '@oxyhq/core';

type ToastMessage = string;

interface SonnerToast {
  (message: ToastMessage): string | number;
  success: (message: ToastMessage) => string | number;
  error: (message: ToastMessage) => string | number;
  info: (message: ToastMessage) => string | number;
}

let cachedToast: SonnerToast | null = null;
let loadStarted = false;
let warnedUnavailable = false;

/**
 * The specifier is held in a variable so static bundler analysis cannot
 * resolve (or fail on) the optional peer. The `import()` expression is a real
 * dynamic import: native in the ESM build, downleveled in the CJS build —
 * never a static `from 'sonner'` reference.
 */
const SONNER_SPECIFIER = 'sonner';

function ensureSonnerLoaded(): void {
  if (cachedToast || loadStarted) {
    return;
  }
  loadStarted = true;
  import(/* @vite-ignore */ SONNER_SPECIFIER)
    .then((mod: { toast?: SonnerToast }) => {
      if (mod?.toast) {
        cachedToast = mod.toast;
      } else if (!warnedUnavailable) {
        warnedUnavailable = true;
        logger.warn('[oxy/auth] sonner loaded but exported no `toast`; toasts are disabled.');
      }
    })
    .catch(() => {
      // `sonner` is an optional peer; absence is expected. No-op silently.
      if (!warnedUnavailable) {
        warnedUnavailable = true;
        logger.warn(
          '[oxy/auth] `sonner` is not installed; auth toasts are disabled. Install `sonner` to enable them.',
        );
      }
    });
}

function emit(method: 'success' | 'error' | 'info', message: ToastMessage): void {
  ensureSonnerLoaded();
  const impl = cachedToast;
  if (!impl) {
    // Not yet loaded (or unavailable). Fire-and-forget UI toast → safe no-op.
    return;
  }
  impl[method](message);
}

/**
 * Drop-in replacement for `sonner`'s `toast` covering the methods used across
 * auth-sdk hooks: `toast.success`, `toast.error`, `toast.info`. Each lazily
 * delegates to `sonner` when available, otherwise no-ops.
 */
export const toast = {
  success(message: ToastMessage): void {
    emit('success', message);
  },
  error(message: ToastMessage): void {
    emit('error', message);
  },
  info(message: ToastMessage): void {
    emit('info', message);
  },
};
