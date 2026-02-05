/**
 * Cross-platform HTML email body renderer.
 * Web: sandboxed iframe with auto-height. Native: react-native-webview with auto-height.
 */

import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { Platform, StyleSheet, useColorScheme } from 'react-native';

interface HtmlBodyProps {
  html: string;
}

// Wrap HTML with basic styling for better rendering
function wrapHtml(html: string, isDark: boolean): string {
  const bgColor = isDark ? '#1a1a1a' : '#ffffff';
  const textColor = isDark ? '#e8eaed' : '#202124';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
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
        a { color: #1a73e8; }
        pre, code { white-space: pre-wrap; word-wrap: break-word; }
        table { max-width: 100%; }
        blockquote {
          margin: 0 0 0 8px;
          padding-left: 12px;
          border-left: 3px solid ${isDark ? '#5f6368' : '#dadce0'};
          color: ${isDark ? '#9aa0a6' : '#5f6368'};
        }
      </style>
    </head>
    <body>${html}</body>
    </html>
  `;
}

function HtmlBodyWeb({ html }: HtmlBodyProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const wrappedHtml = useMemo(() => wrapHtml(html, isDark), [html, isDark]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const updateHeight = () => {
      const doc = iframe.contentDocument;
      if (!doc?.body) return;
      const h = doc.body.scrollHeight;
      if (h > 0) setHeight(h);
    };

    const handleLoad = () => {
      updateHeight();
      // Observe for dynamic content (images, etc.)
      const doc = iframe.contentDocument;
      if (doc?.body) {
        const observer = new ResizeObserver(updateHeight);
        observer.observe(doc.body);
        return () => observer.disconnect();
      }
    };

    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
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
    const colorScheme = useColorScheme();
    const isDark = colorScheme === 'dark';

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
