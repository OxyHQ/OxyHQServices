import React, { useRef, useState, useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useHapticPress } from '@/hooks/use-haptic-press';

interface HorizontalScrollSectionProps {
  children: React.ReactNode;
  onPressIn?: () => void;
  scrollViewStyle?: object;
  contentContainerStyle?: object;
  showArrows?: boolean;
  arrowSize?: number;
}

export function HorizontalScrollSection({
  children,
  onPressIn,
  scrollViewStyle,
  contentContainerStyle,
  showArrows = true,
  arrowSize = 24,
}: HorizontalScrollSectionProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const scrollViewRef = useRef<ScrollView>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  const currentScrollX = useRef(0);
  const handlePressIn = useHapticPress();

  const checkScrollPosition = useCallback((contentWidth: number, scrollX: number, layoutWidth: number) => {
    const canScrollLeft = scrollX > 0;
    const canScrollRight = scrollX < contentWidth - layoutWidth - 10; // 10px threshold
    
    setShowLeftArrow(canScrollLeft);
    setShowRightArrow(canScrollRight);
  }, []);

  const handleScroll = useCallback((event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    currentScrollX.current = contentOffset.x;
    checkScrollPosition(contentSize.width, contentOffset.x, layoutMeasurement.width);
  }, [checkScrollPosition]);

  const handleContentSizeChange = useCallback((contentWidth: number, contentHeight: number) => {
    scrollViewRef.current?.measure((x, y, width, height, pageX, pageY) => {
      if (contentWidth > width) {
        setShowRightArrow(true);
      } else {
        setShowRightArrow(false);
      }
    });
  }, []);

  const scrollLeft = useCallback(() => {
    scrollViewRef.current?.scrollTo({ x: 0, animated: true });
    handlePressIn();
    onPressIn?.();
  }, [handlePressIn, onPressIn]);

  const scrollRight = useCallback(() => {
    scrollViewRef.current?.measure((x, y, width) => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    });
    handlePressIn();
    onPressIn?.();
  }, [handlePressIn, onPressIn]);

  const scrollBy = useCallback((direction: 'left' | 'right', distance: number = 200) => {
    const newX = direction === 'right' 
      ? currentScrollX.current + distance 
      : Math.max(0, currentScrollX.current - distance);
    
    scrollViewRef.current?.scrollTo({ x: newX, animated: true });
    handlePressIn();
    onPressIn?.();
  }, [handlePressIn, onPressIn]);

  // Gradient colors based on theme - fade from transparent at edges to background color near arrows
  const gradientColors = useMemo(() => {
    const bgColor = colors.background;
    return {
      // Left: bgColor near arrow → transparent at left edge
      left: [bgColor, 'transparent'],
      // Right: transparent at right edge → bgColor near arrow
      right: ['transparent', bgColor],
    };
  }, [colors.background]);

  return (
    <View style={styles.container}>
      {/* Left gradient overlay */}
      {showArrows && showLeftArrow && (
        <>
          <LinearGradient
            colors={gradientColors.left}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.gradientOverlay, styles.leftGradient]}
            pointerEvents="none"
          />
          <TouchableOpacity
            style={[styles.arrowButton, styles.leftArrow, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => scrollBy('left')}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="chevron-left" size={arrowSize} color={colors.text} />
          </TouchableOpacity>
        </>
      )}
      
      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.scrollView, scrollViewStyle]}
        contentContainerStyle={[styles.horizontalScrollContent, contentContainerStyle]}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onContentSizeChange={handleContentSizeChange}
      >
        {children}
      </ScrollView>

      {/* Right gradient overlay */}
      {showArrows && showRightArrow && (
        <>
          <LinearGradient
            colors={gradientColors.right}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.gradientOverlay, styles.rightGradient]}
            pointerEvents="none"
          />
          <TouchableOpacity
            style={[styles.arrowButton, styles.rightArrow, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => scrollBy('right')}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="chevron-right" size={arrowSize} color={colors.text} />
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
  } as const,
  scrollView: {
    flex: 1,
    marginHorizontal: -16, // Extend to screen edges (compensate for parent padding)
  } as const,
  horizontalScrollContent: {
    paddingLeft: 16,
    paddingRight: 16,
  } as const,
  gradientOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 60,
    height: '100%',
    zIndex: 5,
    pointerEvents: 'none',
  } as const,
  leftGradient: {
    left: -16, // Match ScrollView's marginHorizontal: -16
  } as const,
  rightGradient: {
    right: -16, // Match ScrollView's marginHorizontal: -16
  } as const,
  arrowButton: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    zIndex: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  } as const,
  leftArrow: {
    left: -12, // Align with ScrollView edge accounting for marginHorizontal: -16
  } as const,
  rightArrow: {
    right: -12, // Align with ScrollView edge accounting for marginHorizontal: -16
  } as const,
});

