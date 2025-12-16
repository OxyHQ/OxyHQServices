import React, { useMemo } from 'react';
import { StyleSheet, RefreshControl, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedScrollHandler, runOnJS } from 'react-native-reanimated';
import { useScrollContext } from '@/contexts/scroll-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface ScreenContentWrapperProps {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}

// Header dimensions - must match MobileHeader component
const HEADER_TOP_PADDING = 4;
// Content height: top row (menu button 24px icon + 6px padding top + 6px padding bottom = 36px) + search bar (8px top + 48px height + 10px bottom = 66px)
const HEADER_CONTENT_HEIGHT = 36 + 66; // 102px total

export function ScreenContentWrapper({ children, refreshing = false, onRefresh }: ScreenContentWrapperProps) {
  const { setIsScrolled, scrollRef, scrollY, scrollDirection } = useScrollContext();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);

  // Check if we're on mobile (header is absolutely positioned on mobile)
  const isMobile = Platform.OS !== 'web' || (Platform.OS === 'web' && width < 768);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const currentY = event.contentOffset.y;
      const previousY = scrollY.value;

      scrollY.value = currentY;

      // Determine scroll direction
      if (currentY > previousY) {
        scrollDirection.value = 'down';
      } else if (currentY < previousY) {
        scrollDirection.value = 'up';
      }

      // Update isScrolled state on JS thread
      if (currentY > 10 !== (previousY > 10)) {
        runOnJS(setIsScrolled)(currentY > 10);
      }
    },
  }, []);

  // Calculate header height: safe area + header padding + content
  // This matches the header's actual rendered height on mobile
  // Header has: paddingTop (insets.top + 4) + top row (36) + search bar (66) = total
  // Only apply paddingTop when header is absolutely positioned (mobile)
  const headerHeight = useMemo(() => {
    return insets.top + HEADER_TOP_PADDING + HEADER_CONTENT_HEIGHT;
  }, [insets.top]);

  return (
    <Animated.ScrollView
      ref={scrollRef}
      style={styles.scrollView}
      contentContainerStyle={[
        styles.contentContainer,
        isMobile && { paddingTop: headerHeight }
      ]}
      showsVerticalScrollIndicator={false}
      onScroll={scrollHandler}
      scrollEventThrottle={16}
      nestedScrollEnabled={true}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      contentInset={{ top: 0, bottom: 0, left: 0, right: 0 }}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.tint}
            colors={[colors.tint]}
            progressViewOffset={isMobile ? headerHeight + 8 : 8}
            progressBackgroundColor={colors.background}
          />
        ) : undefined
      }
    >
      {children}
    </Animated.ScrollView>
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

