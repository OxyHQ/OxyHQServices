import type React from 'react';

/**
 * Font loading — clean default (web, SSR, and any bundler that does not pick a
 * platform variant).
 *
 * Web fonts are Bloom's job: `applyFontFaces()` in `@oxyhq/bloom` injects the
 * Inter / BlomusModernus / Geist Mono `@font-face` rules as self-contained
 * base64 data URLs, so there is nothing for this package to load off native.
 * The real implementation lives in `FontLoader.native.tsx`.
 *
 * Keeping this module free of `expo-font` is load-bearing, not incidental:
 * `expo-font/build/serverContext.web.js` imports `node:async_hooks`, which
 * every browser bundler externalizes. A top-level `expo-font` import here
 * therefore throws at module-evaluation time on web and React never mounts.
 */
export const FontLoader = ({
    children,
}: {
    children: React.ReactNode;
}) => <>{children}</>;

/**
 * No-op off native. Returns `true` because setup genuinely succeeded — there is
 * simply nothing to do here — so callers do not log a spurious failure.
 */
export const setupFonts = async (): Promise<boolean> => true;
