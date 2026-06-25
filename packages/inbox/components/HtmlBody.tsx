/**
 * Cross-platform HTML email body renderer.
 * Web: sandboxed iframe with auto-height. Native: react-native-webview with auto-height.
 *
 * External images and fonts are routed through our proxy to:
 * - Bypass CORS/CORP restrictions
 * - Protect user privacy (hide IP from email senders)
 * - Block tracking pixels
 */

import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { Platform, StyleSheet, Linking } from 'react-native';
import { useTheme } from '@oxyhq/bloom/theme';
import { proxyExternalImages, getProxyBaseUrl } from '../utils/htmlTransform';

interface HtmlBodyProps {
  html: string;
}

const ALLOWED_EXTERNAL_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const CONTROL_OR_SPACE_BOUNDARY = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g;

function getSafeExternalUrl(href: string | null | undefined): string | null {
  const trimmedHref = href?.replace(CONTROL_OR_SPACE_BOUNDARY, '');
  if (!trimmedHref || trimmedHref.startsWith('#')) return null;

  try {
    const url = new URL(trimmedHref);
    if (!ALLOWED_EXTERNAL_LINK_PROTOCOLS.has(url.protocol.toLowerCase())) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isUserInitiatedNativeNavigation(request: { navigationType?: string; isTopFrame?: boolean }) {
  // iOS provides navigationType; Android may omit it for WebView navigations.
  // Only open links externally when the WebView identifies a real link click.
  return request.isTopFrame !== false && request.navigationType === 'click';
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
  const proxiedHtml = proxyExternalImages(html, proxyBaseUrl);

  return `
    <!DOCTYPE html>
    <html${isDark ? ' style="color-scheme: dark;"' : ''}>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
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

      // Intercept link clicks — validate and open safe external links from the parent.
      // Email HTML is attacker-controlled, so never allow the sandbox to open popups directly.
      doc.addEventListener('click', (e: MouseEvent) => {
        const anchor = (e.target as HTMLElement).closest?.('a');
        if (!anchor) return;

        e.preventDefault();
        const safeUrl = getSafeExternalUrl(anchor.getAttribute('href'));
        if (!safeUrl) return;

        window.open(safeUrl, '_blank', 'noopener,noreferrer');
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
      sandbox="allow-same-origin"
      title="Email content"
      scrolling="no"
    />
  );
}

const HEIGHT_SCRIPT = `
  <script>
    (function() {
      function postHeight() {
        var h = document.body.scrollHeight;
        if (h > 0) window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'height', value: h }));
      }
      // Post height immediately and on load
      postHeight();
      document.addEventListener('DOMContentLoaded', postHeight);
      window.addEventListener('load', postHeight);
      // Watch for images loading
      document.querySelectorAll('img').forEach(function(img) {
        img.addEventListener('load', postHeight);
      });
      // Observe mutations
      new MutationObserver(postHeight).observe(document.body, { childList: true, subtree: true, attributes: true });
    })();
  </script>
`;

let HtmlBodyNative: React.ComponentType<HtmlBodyProps> | null = null;

if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebView } = require('react-native-webview');

  HtmlBodyNative = function HtmlBodyNativeComponent({ html }: HtmlBodyProps) {
    const [height, setHeight] = useState<number | null>(null);
    const { mode } = useTheme();
    const isDark = mode === 'dark';

    const wrappedHtml = useMemo(() => wrapHtml(html, isDark) + HEIGHT_SCRIPT, [html, isDark]);

    const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === 'height' && msg.value > 0) {
          setHeight(msg.value);
        }
      } catch {
        // ignore
      }
    }, []);

    // Open user-clicked safe links in the system browser instead of navigating the WebView.
    const handleNavigation = useCallback((request: { url: string; navigationType?: string; isTopFrame?: boolean }) => {
      const { url } = request;
      // Allow the initial HTML load (about:blank or data: URLs)
      if (url === 'about:blank' || url.startsWith('data:') || url.startsWith('about:')) {
        return true;
      }

      const safeUrl = getSafeExternalUrl(url);
      if (safeUrl && isUserInitiatedNativeNavigation(request)) {
        Linking.openURL(safeUrl);
      }
      return false; // Block navigation inside WebView
    }, []);

    return (
      <WebView
        originWhitelist={['*']}
        source={{ html: wrappedHtml }}
        style={[styles.webView, height ? { height } : { minHeight: 100 }]}
        scalesPageToFit={false}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={handleNavigation}
        javaScriptEnabled
        domStorageEnabled={false}
        startInLoadingState={false}
        cacheEnabled
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
  },
});
