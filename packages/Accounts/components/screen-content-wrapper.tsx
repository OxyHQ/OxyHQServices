import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScrollContext } from '@/contexts/scroll-context';

interface ScreenContentWrapperProps {
  children: React.ReactNode;
}

export function ScreenContentWrapper({ children }: ScreenContentWrapperProps) {
  const { setIsScrolled } = useScrollContext();
  const insets = useSafeAreaInsets();

  const handleScroll = (event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    setIsScrolled(offsetY > 10);
  };

  // Header height: safe area top + header top padding (16) + content height (~56) + bottom padding (16)
  // Content height: icons (24px) + avatar (36px) + button padding, roughly 56px
  const headerContentHeight = 56; // Approximate height of header content row (icons + avatar)
  const headerTopPadding = 16;
  const headerBottomPadding = 16;
  const headerTotalHeight = insets.top + headerTopPadding + headerContentHeight + headerBottomPadding;

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingTop: headerTotalHeight }
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

