/**
 * Root HTML template for the web build.
 *
 * Owns the `<head>` of every statically-generated page. Per-route metadata
 * (title overrides, dynamic descriptions) is layered on top via
 * `<Head>` from `expo-router/head` inside each screen.
 *
 * Reference: https://docs.expo.dev/router/reference/static-rendering/#root-html
 */

import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

const DEFAULT_TITLE = 'Inbox by Oxy';
const DEFAULT_DESCRIPTION = 'Email by Oxy. Federated, encrypted, simple.';
const SITE_NAME = 'Inbox by Oxy';
const OG_IMAGE = '/assets/images/icon.png';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />

        <title>{DEFAULT_TITLE}</title>
        <meta name="description" content={DEFAULT_DESCRIPTION} />
        <meta name="application-name" content={SITE_NAME} />
        <meta name="apple-mobile-web-app-title" content="Inbox" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />

        {/* Theme color (light + dark) */}
        <meta
          name="theme-color"
          content="#FFFFFF"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#0A0A0A"
          media="(prefers-color-scheme: dark)"
        />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE_NAME} />
        <meta property="og:title" content={DEFAULT_TITLE} />
        <meta property="og:description" content={DEFAULT_DESCRIPTION} />
        <meta property="og:image" content={OG_IMAGE} />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={DEFAULT_TITLE} />
        <meta name="twitter:description" content={DEFAULT_DESCRIPTION} />
        <meta name="twitter:image" content={OG_IMAGE} />

        {/* PWA manifest */}
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* Strip device-join credentials before the JS bundle (Expo Router reads location.hash on boot). */}
        <script src="/device-join-strip.js" />

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
