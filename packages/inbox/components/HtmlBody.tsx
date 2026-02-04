/**
 * Cross-platform HTML email body renderer.
 * Web: sandboxed iframe with auto-height. Native: react-native-webview with auto-height.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';

interface HtmlBodyProps {
  html: string;
}

function HtmlBodyWeb({ html }: HtmlBodyProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument?.body) return;

    const updateHeight = () => {
      const h = iframe.contentDocument?.body.scrollHeight;
      if (h && h > 0) setHeight(h);
    };

    updateHeight();

    // Observe content size changes (images loading, etc.)
    const observer = new ResizeObserver(updateHeight);
    observer.observe(iframe.contentDocument.body);
    return () => observer.disconnect();
  }, []);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={html}
      style={{ border: 'none', width: '100%', height }}
      sandbox="allow-same-origin"
      title="Email content"
      onLoad={handleLoad}
    />
  );
}

const HEIGHT_SCRIPT = `
  <script>
    function postHeight() {
      var h = document.body.scrollHeight;
      if (h > 0) window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'height', value: h }));
    }
    window.addEventListener('load', function() { setTimeout(postHeight, 50); });
    new MutationObserver(postHeight).observe(document.body, { childList: true, subtree: true, attributes: true });
    postHeight();
  </script>
`;

let HtmlBodyNative: React.ComponentType<HtmlBodyProps> | null = null;

if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebView } = require('react-native-webview');

  HtmlBodyNative = function HtmlBodyNativeComponent({ html }: HtmlBodyProps) {
    const [height, setHeight] = useState(200);

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
        source={{ html: html + HEIGHT_SCRIPT }}
        style={[styles.webView, { height }]}
        scalesPageToFit={false}
        scrollEnabled={false}
        nestedScrollEnabled
        onMessage={handleMessage}
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
