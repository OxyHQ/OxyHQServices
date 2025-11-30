import React, { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScrollContext } from '@/contexts/scroll-context';

interface ScreenContentWrapperProps {
  children: React.ReactNode;
}

// Header dimensions - must match MobileHeader component
const HEADER_TOP_PADDING = 4;
const HEADER_BOTTOM_PADDING = 10;
// Content height: menu button (24px icon + 6px padding top + 6px padding bottom = 36px) is tallest
const HEADER_CONTENT_HEIGHT = 36;

export function ScreenContentWrapper({ children }: ScreenContentWrapperProps) {
  const { setIsScrolled } = useScrollContext();
  const insets = useSafeAreaInsets();

  const handleScroll = (event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    setIsScrolled(offsetY > 10);
  };

  // Calculate header height: safe area + header padding + content + bottom padding
  const headerHeight = useMemo(() => {
    return insets.top + HEADER_TOP_PADDING + HEADER_CONTENT_HEIGHT + HEADER_BOTTOM_PADDING;
  }, [insets.top]);

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingTop: headerHeight }
      ]}
      showsVerticalScrollIndicator={false}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      nestedScrollEnabled={true}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
    paddingBottom: 20,
  },
});

