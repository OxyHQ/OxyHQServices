import React, { forwardRef, useImperativeHandle, useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Modal,
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  Platform,
  StatusBar,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

// Import Toaster for internal toast rendering
import { Toaster } from '../../../lib/sonner';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

export interface BottomSheetModalProps {
  children?: React.ReactNode;
  snapPoints?: (string | number)[];
  index?: number;
  enablePanDownToClose?: boolean;
  backdropComponent?: React.ComponentType<any>;
  handleComponent?: React.ComponentType<any>;
  backgroundStyle?: any;
  handleIndicatorStyle?: any;
  onChange?: (index: number) => void;
  onAnimate?: (fromIndex: number, toIndex: number) => void;
  keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
  keyboardBlurBehavior?: 'none' | 'restore';
  android_keyboardInputMode?: 'adjustPan' | 'adjustResize';
  enableOverDrag?: boolean;
  enableContentPanningGesture?: boolean;
  enableHandlePanningGesture?: boolean;
  overDragResistanceFactor?: number;
  enableBlurKeyboardOnGesture?: boolean;
  enableInternalToaster?: boolean; // New prop to enable internal toaster
}

export interface BottomSheetModalRef {
  present: () => void;
  dismiss: () => void;
  expand: () => void;
  collapse: () => void;
  close: () => void;
  snapToIndex: (index: number) => void;
  snapToPosition: (position: string | number) => void;
}

// Helper function to convert snap point to actual height
const getSnapPointHeight = (snapPoint: string | number): number => {
  if (typeof snapPoint === 'string') {
    const percentage = parseInt(snapPoint.replace('%', ''));
    return (SCREEN_HEIGHT * percentage) / 100;
  }
  return snapPoint;
};

export const BottomSheetModal = forwardRef<BottomSheetModalRef, BottomSheetModalProps>(
  ({
    children,
    snapPoints = [],
    index = 0,
    enablePanDownToClose = true,
    backdropComponent: BackdropComponent,
    handleComponent: HandleComponent,
    backgroundStyle,
    handleIndicatorStyle,
    onChange,
    onAnimate,
    keyboardBehavior = 'interactive',
    keyboardBlurBehavior = 'restore',
    android_keyboardInputMode = 'adjustResize',
    enableOverDrag = false,
    enableContentPanningGesture = true,
    enableHandlePanningGesture = true,
    overDragResistanceFactor = 2.5,
    enableBlurKeyboardOnGesture = true,
    enableInternalToaster = false, // Default to false
  }, ref) => {
    const [isVisible, setIsVisible] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(index);
    const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;

    // Get the height for current snap point
    const getCurrentSnapHeight = useCallback(() => {
      if (currentIndex >= 0 && currentIndex < snapPoints.length) {
        return getSnapPointHeight(snapPoints[currentIndex]);
      }
      return getSnapPointHeight(snapPoints[0]);
    }, [currentIndex, snapPoints]);

    // Get the translateY value for a specific snap point
    const getTranslateYForIndex = useCallback((targetIndex: number) => {
      const targetHeight = getSnapPointHeight(snapPoints[targetIndex]);
      return SCREEN_HEIGHT - targetHeight;
    }, [snapPoints]);

    // Animation to show/hide the modal
    const animateToPosition = useCallback((toIndex: number, onComplete?: () => void) => {
      const fromIndex = currentIndex;
      
      if (onAnimate) {
        onAnimate(fromIndex, toIndex);
      }

      if (toIndex === -1) {
        // Dismiss animation
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: SCREEN_HEIGHT,
            duration: 300,
            useNativeDriver: false, // Don't use native driver due to layout properties
          }),
          Animated.timing(backdropOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: Platform.OS !== 'web',
          }),
        ]).start(() => {
          setIsVisible(false);
          setCurrentIndex(-1);
          if (onChange) onChange(-1);
          if (onComplete) onComplete();
        });
      } else {
        // Show/snap animation
        const targetTranslateY = getTranslateYForIndex(toIndex);

        if (!isVisible) {
          setIsVisible(true);
        }

        Animated.parallel([
          Animated.timing(translateY, {
            toValue: targetTranslateY,
            duration: 300,
            useNativeDriver: false, // Don't use native driver due to layout properties
          }),
          Animated.timing(backdropOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: Platform.OS !== 'web',
          }),
        ]).start(() => {
          setCurrentIndex(toIndex);
          if (onChange) onChange(toIndex);
          if (onComplete) onComplete();
        });
      }
    }, [currentIndex, snapPoints, translateY, backdropOpacity, onChange, onAnimate, getTranslateYForIndex, isVisible]);

    // Pan responder for drag gestures
    const panResponder = useRef(
      PanResponder.create({
        onMoveShouldSetPanResponder: (evt, gestureState) => {
          // More sensitive gesture detection - allow both up and down gestures
          return Math.abs(gestureState.dy) > 5 && (enablePanDownToClose || enableHandlePanningGesture);
        },
        onPanResponderGrant: () => {
          // Get current offset value
          const currentValue = (translateY as any)._value || 0;
          translateY.setOffset(currentValue);
          translateY.setValue(0);
        },
        onPanResponderMove: (evt, gestureState) => {
          // Allow both upward and downward drags for better UX
          const resistance = overDragResistanceFactor || 2.5;
          
          if (gestureState.dy > 0) {
            // Downward drag - apply resistance for overdrag
            const resistedValue = gestureState.dy / resistance;
            translateY.setValue(resistedValue);
          } else if (gestureState.dy < 0 && currentIndex < snapPoints.length - 1) {
            // Upward drag - allow direct movement to expand
            translateY.setValue(gestureState.dy);
          }
        },
        onPanResponderRelease: (evt, gestureState) => {
          translateY.flattenOffset();
          
          const currentHeight = getCurrentSnapHeight();
          const dragDistance = gestureState.dy;
          const dragVelocity = gestureState.vy;

          // Improved gesture detection for better UX
          if (dragDistance > 50 || dragVelocity > 0.3) {
            // Downward gesture - dismiss or snap to lower position
            if (currentIndex === 0 || dragDistance > currentHeight * 0.25) {
              animateToPosition(-1); // Dismiss
            } else {
              animateToPosition(currentIndex - 1); // Snap to lower position
            }
          } else if (dragDistance < -50 || dragVelocity < -0.3) {
            // Upward gesture - snap to higher position
            if (currentIndex < snapPoints.length - 1) {
              animateToPosition(currentIndex + 1);
            }
          } else {
            // Small movement - snap back to current position
            animateToPosition(currentIndex);
          }
        },
      })
    ).current;

    // Imperative handle for ref methods
    useImperativeHandle(ref, () => ({
      present: () => {
        setIsVisible(true);
        setCurrentIndex(index);
        animateToPosition(index);
      },
      dismiss: () => {
        animateToPosition(-1);
      },
      expand: () => {
        if (currentIndex < snapPoints.length - 1) {
          animateToPosition(snapPoints.length - 1);
        }
      },
      collapse: () => {
        animateToPosition(0);
      },
      close: () => {
        animateToPosition(-1);
      },
      snapToIndex: (newIndex: number) => {
        if (newIndex >= 0 && newIndex < snapPoints.length) {
          animateToPosition(newIndex);
        }
      },
      snapToPosition: (position: string | number) => {
        const index = snapPoints.findIndex(sp => sp === position);
        if (index !== -1) {
          animateToPosition(index);
        }
      },
    }));

    // Handle backdrop press
    const handleBackdropPress = useCallback(() => {
      if (enablePanDownToClose) {
        animateToPosition(-1);
      }
    }, [enablePanDownToClose, animateToPosition]);

    // Default handle component
    const DefaultHandle = () => (
      <View 
        style={styles.handleContainer}
        {...(enableHandlePanningGesture ? panResponder.panHandlers : {})}
      >
        <View style={[
          styles.handle, 
          handleIndicatorStyle,
          // Apply the same default styling as the original
          !handleIndicatorStyle?.backgroundColor && {
            backgroundColor: '#CCCCCC'
          }
        ]} />
      </View>
    );

    if (!isVisible) {
      return null;
    }

    return (
      <Modal
        visible={isVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => animateToPosition(-1)}
      >
        {/* Backdrop */}
        <Animated.View
          style={[
            styles.backdrop,
            {
              opacity: backdropOpacity,
            },
          ]}
        >
          {BackdropComponent ? (
            <BackdropComponent onPress={handleBackdropPress} />
          ) : (
            <View style={styles.defaultBackdrop} onTouchStart={handleBackdropPress} />
          )}
        </Animated.View>

        {/* Bottom Sheet Container */}
        <Animated.View
          style={[
            styles.container,
            {
              transform: [{ translateY }],
              height: SCREEN_HEIGHT, // Full height container
            },
          ]}
        >
          <View 
            style={[styles.sheet, backgroundStyle]}
            {...(enableContentPanningGesture ? panResponder.panHandlers : {})}
          >
            {/* Handle */}
            {HandleComponent ? <HandleComponent /> : <DefaultHandle />}
            
            {/* Content */}
            <ScrollView style={styles.content}>
              {children}
            </ScrollView>
          </View>
        </Animated.View>

        {/* Internal Toaster - Renders on top of the backdrop */}
        {enableInternalToaster && (
          <View style={styles.toasterContainer}>
            <Toaster position="top-center" swipeToDismissDirection="left" offset={15} />
          </View>
        )}
      </Modal>
    );
  }
);

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  defaultBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    alignItems: 'center', // Center the sheet horizontally
    justifyContent: 'flex-end', // Align to bottom
  },
  sheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 35,
    borderTopRightRadius: 35,
    minHeight: 200,
    height: '100%', // Take full available height
    width: '100%', // Full width by default
    maxWidth: 800, // Maximum width for larger screens
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: {
          width: 0,
          height: -2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 10,
      },
      android: {
        elevation: 10,
      },
      web: {
        boxShadow: '0 -2px 10px rgba(0, 0, 0, 0.25)',
        // For web, ensure the sheet is centered properly
        marginLeft: 'auto',
        marginRight: 'auto',
      },
    }),
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: 12,
    // Make the handle area more touch-friendly
    paddingHorizontal: 20,
    minHeight: 40, // Ensure minimum touch target
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#CCCCCC',
    borderRadius: 2,
    alignSelf: 'center',
  },
  content: {
    flex: 1,
  },
  toasterContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Ensure toaster is above everything in the Modal context
    zIndex: 10000,
    elevation: 10000, // For Android
    pointerEvents: 'box-none', // Allow touches to pass through to underlying components
  },
});

BottomSheetModal.displayName = 'BottomSheetModal';