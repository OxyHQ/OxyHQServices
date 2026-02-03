/**
 * Cross-platform HTML email body renderer.
 * Web: sandboxed iframe. Native: react-native-webview.
 */

import React from 'react';
import { Platform, StyleSheet } from 'react-native';

interface HtmlBodyProps {
  html: string;
}

function HtmlBodyWeb({ html }: HtmlBodyProps) {
  return (
    <iframe
      srcDoc={html}
      style={{ border: 'none', width: '100%', minHeight: 400 }}
      sandbox="allow-same-origin"
      title="Email content"
    />
  );
}

let HtmlBodyNative: React.ComponentType<HtmlBodyProps> | null = null;

if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebView } = require('react-native-webview');

  HtmlBodyNative = function HtmlBodyNativeComponent({ html }: HtmlBodyProps) {
    return (
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={styles.webView}
        scalesPageToFit={false}
        scrollEnabled={false}
        nestedScrollEnabled
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
    minHeight: 300,
    backgroundColor: 'transparent',
  },
});
