import { ScrollViewStyleReset } from 'expo-router/html';
import { DEVICE_JOIN_URL_STRIP_INLINE_SCRIPT } from '@oxyhq/core';
import type { PropsWithChildren } from 'react';

const DEFAULT_TITLE = 'Accounts by Oxy';
const DEFAULT_DESCRIPTION = 'Manage your Oxy account, identity, sessions, and security.';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />

        <title>{DEFAULT_TITLE}</title>
        <meta name="description" content={DEFAULT_DESCRIPTION} />
        <meta name="application-name" content="Accounts by Oxy" />
        <meta name="apple-mobile-web-app-title" content="Accounts" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />

        <meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#050505" media="(prefers-color-scheme: dark)" />

        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Accounts by Oxy" />
        <meta property="og:title" content={DEFAULT_TITLE} />
        <meta property="og:description" content={DEFAULT_DESCRIPTION} />

        {/* Strip device-join credentials from the URL before the JS bundle loads. */}
        <script dangerouslySetInnerHTML={{ __html: DEVICE_JOIN_URL_STRIP_INLINE_SCRIPT }} />

        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
