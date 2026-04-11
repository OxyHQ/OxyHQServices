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

/**
 * Wrap email HTML with styling and proxy external resources.
 *
 * Dark mode strategy:
 * - Set `color-scheme: dark` so the browser knows the document is dark.
 * - Apply dark background/text with `!important` on html/body to override
 *   email sender stylesheets that hardcode `background: white`.
 * - Invert bright inline-styled elements via a targeted CSS filter on common
 *   container patterns (tables, divs with explicit bg) so marketing emails
 *   don't produce a white flash inside the dark app shell.
 * - Images are excluded from inversion to preserve their appearance.
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

  // Dark-mode-specific overrides that force dark appearance even when
  // email senders hardcode white backgrounds via inline styles.
  const darkOverrides = isDark
    ? `
      /* Force dark on root elements — !important overrides inline styles */
      html, body {
        background-color: ${bgColor} !important;
        color: ${textColor} !important;
      }
      /* Override common email wrapper patterns with explicit white backgrounds */
      body > div, body > table, body > center,
      body > div > div, body > div > table,
      body > table > tbody > tr > td {
        background-color: transparent !important;
        color: inherit !important;
      }
      /* Force text colors on common inline-styled elements */
      p, span, li, td, th, h1, h2, h3, h4, h5, h6, div, center {
        color: ${textColor} !important;
      }
      /* Preserve legibility for elements with very bright backgrounds by
         making backgrounds transparent so the dark root shows through */
      [style*="background-color: #fff"],
      [style*="background-color: #FFF"],
      [style*="background-color:#fff"],
      [style*="background-color:#FFF"],
      [style*="background-color: white"],
      [style*="background-color:white"],
      [style*="background-color: #ffffff"],
      [style*="background-color: #FFFFFF"],
      [style*="background-color:#ffffff"],
      [style*="background-color:#FFFFFF"],
      [style*="background: #fff"],
      [style*="background: #FFF"],
      [style*="background: white"],
      [style*="background: #ffffff"],
      [style*="background: #FFFFFF"],
      [style*="background:#fff"],
      [style*="background:#ffffff"],
      [style*="background-color: rgb(255, 255, 255)"],
      [style*="background-color: rgb(255,255,255)"] {
        background-color: transparent !important;
      }
      /* Light gray backgrounds (f5f5f5, f8f8f8, fafafa, etc.) -> dark surface */
      [style*="background-color: #f"],
      [style*="background-color:#f"],
      [style*="background: #f"] {
        background-color: #1f1f1f !important;
      }
      /* Ensure images are NOT color-inverted */
      img { filter: none !important; }
    `
    : '';

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
        ${darkOverrides}
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

    // Open links in the system browser instead of navigating the WebView
    const handleNavigation = useCallback((request: { url: string }) => {
      const { url } = request;
      // Allow the initial HTML load (about:blank or data: URLs)
      if (url === 'about:blank' || url.startsWith('data:') || url.startsWith('about:')) {
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
