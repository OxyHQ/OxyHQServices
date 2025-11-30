import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useScrollContext } from '@/contexts/scroll-context';

interface ScrollableScreenWrapperProps {
  children: React.ReactNode;
}

export function ScrollableScreenWrapper({ children }: ScrollableScreenWrapperProps) {
  const { setIsScrolled } = useScrollContext();

  const handleScroll = (event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    setIsScrolled(offsetY > 10);
  };

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      onScroll={handleScroll}
      scrollEventThrottle={16}
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
  },
});

