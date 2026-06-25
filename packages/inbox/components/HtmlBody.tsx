/**
 * Cross-platform HTML email body renderer.
 * Web: sandboxed iframe with auto-height. Native: locked-down react-native-webview.
 *
 * External images and fonts are routed through our proxy to:
 * - Bypass CORS/CORP restrictions
 * - Protect user privacy (hide IP from email senders)
 * - Block tracking pixels
 */

import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { Platform, StyleSheet, Linking } from 'react-native';
import { useTheme } from '@oxyhq/bloom/theme';
import { proxyExternalImages, getProxyBaseUrl, sanitizeEmailHtml } from '../utils/htmlTransform';

interface HtmlBodyProps {
  html: string;
}

/**
 * Wrap email HTML with styling and proxy external resources.
 *
 * Dark mode strategy (feature-detection rather than forced override):
 * - Set `color-scheme: dark` on the document so well-behaved emails can opt
 *   in to a dark variant via CSS `@media (prefers-color-scheme: dark)` or
 *   `light-dark()` declarations. Modern marketing email systems
 *   (Mailchimp, Litmus, Apple Mail's adaptive engine, etc.) already use
 *   this signal, so we trust it.
 * - Apply our own background/text only on `html` and `body` themselves
 *   (without `!important`) so the email's own root-level styling wins
 *   when present.
 * - Crucially, do NOT force `background-color: transparent` on `body > div`,
 *   `body > table`, or `body > center`. That used to break marketing emails
 *   with branded coloured header bars (Apple, Stripe, GitHub notifications,
 *   etc.) because those wrappers carry the header background.
 * - Images are unaffected — no `filter: invert` or similar tricks.
 *
 * The result: a slightly worse rendering for emails that hardcode
 * `background: white` and don't honour `color-scheme`, but correct
 * rendering for the rich-HTML newsletters that actually matter.
 */
function wrapHtml(html: string, isDark: boolean): string {
  const bgColor = isDark ? '#000000' : '#ffffff';
  const textColor = isDark ? '#e8eaed' : '#202124';
  const linkColor = isDark ? '#8ab4f8' : '#1a73e8';
  const quoteBorderColor = isDark ? '#5f6368' : '#dadce0';
  const quoteTextColor = isDark ? '#9aa0a6' : '#5f6368';

  // Transform external image/font URLs to go through our proxy
  const proxyBaseUrl = getProxyBaseUrl();
  const sanitizedHtml = sanitizeEmailHtml(html);
  const proxiedHtml = proxyExternalImages(sanitizedHtml, proxyBaseUrl);

  return `
    <!DOCTYPE html>
    <html${isDark ? ' style="color-scheme: dark;"' : ''}>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
      <base target="_blank">
      ${isDark ? '<meta name="color-scheme" content="dark">' : ''}
      <style>
        * { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 0;
          background: ${bgColor};
          color: ${textColor};
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 15px;
          line-height: 1.5;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        img { max-width: 100%; height: auto; }
        a { color: ${linkColor}; }
        pre, code { white-space: pre-wrap; word-wrap: break-word; }
        table { max-width: 100%; }
        blockquote {
          margin: 0 0 0 8px;
          padding-left: 12px;
          border-left: 3px solid ${quoteBorderColor};
          color: ${quoteTextColor};
        }
      </style>
    </head>
    <body>${proxiedHtml}</body>
    </html>
  `;
}

function HtmlBodyWeb({ html }: HtmlBodyProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const { mode } = useTheme();
  const isDark = mode === 'dark';

  const wrappedHtml = useMemo(() => wrapHtml(html, isDark), [html, isDark]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let observer: ResizeObserver | null = null;

    const updateHeight = () => {
      const doc = iframe.contentDocument;
      if (!doc?.body) return;
      const h = doc.body.scrollHeight;
      if (h > 0) setHeight(h);
    };

    const handleLoad = () => {
      const doc = iframe.contentDocument;
      if (!doc?.body) return;

      // Set up observer first to catch fast-resolving cached images
      observer = new ResizeObserver(updateHeight);
      observer.observe(doc.body);

      updateHeight();

      // Guard for images that complete between measurement and observer attach.
      // { once: true } auto-removes the listener after firing — no leak.
      doc.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
        if (!img.complete) {
          img.addEventListener('load', updateHeight, { once: true });
          img.addEventListener('error', updateHeight, { once: true });
        }
      });

      // Intercept link clicks — open in new tab instead of navigating the iframe.
      // The <base target="_blank"> handles most links, but this catches edge cases
      // (e.g. links with explicit target, javascript: hrefs, etc.)
      doc.addEventListener('click', (e: MouseEvent) => {
        const anchor = (e.target as HTMLElement).closest?.('a');
        if (!anchor) return;
        const href = anchor.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        window.open(href, '_blank', 'noopener,noreferrer');
      });
    };

    iframe.addEventListener('load', handleLoad);
    return () => {
      iframe.removeEventListener('load', handleLoad);
      observer?.disconnect();
    };
  }, [wrappedHtml]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={wrappedHtml}
      style={{
        border: 'none',
        width: '100%',
        height: height ?? 'auto',
        minHeight: height ? undefined : 100,
        display: 'block',
        overflow: 'hidden',
      }}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      title="Email content"
      scrolling="no"
    />
  );
}

let HtmlBodyNative: React.ComponentType<HtmlBodyProps> | null = null;

if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebView } = require('react-native-webview');

  HtmlBodyNative = function HtmlBodyNativeComponent({ html }: HtmlBodyProps) {
    const { mode } = useTheme();
    const isDark = mode === 'dark';

    const wrappedHtml = useMemo(() => wrapHtml(html, isDark), [html, isDark]);

    // Open links in the system browser instead of navigating the WebView
    const handleNavigation = useCallback((request: { url: string }) => {
      const { url } = request;
      // Allow the initial HTML load only. All user-clicked navigations leave the WebView.
      if (url === 'about:blank' || url.startsWith('about:')) {
        return true;
      }
      // Open external links in system browser
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
        Linking.openURL(url);
      }
      return false; // Block navigation inside WebView
    }, []);

    return (
      <WebView
        originWhitelist={['about:blank']}
        source={{ html: wrappedHtml }}
        style={styles.webView}
        scalesPageToFit={false}
        scrollEnabled
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        onShouldStartLoadWithRequest={handleNavigation}
        javaScriptEnabled={false}
        domStorageEnabled={false}
        startInLoadingState={false}
        cacheEnabled={false}
        mixedContentMode="never"
        setSupportMultipleWindows={false}
      />
    );
  };
}

export function HtmlBody({ html }: HtmlBodyProps) {
  if (Platform.OS === 'web') {
    return <HtmlBodyWeb html={html} />;
  }
  if (HtmlBodyNative) {
    return <HtmlBodyNative html={html} />;
  }
  return null;
}

const styles = StyleSheet.create({
  webView: {
    backgroundColor: 'transparent',
    minHeight: 400,
  },
});
