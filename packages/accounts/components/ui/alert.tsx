import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
  Dimensions,
  ScrollView,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface AlertProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons?: AlertButton[];
  onDismiss: () => void;
}

export function Alert({ visible, title, message, buttons = [], onDismiss }: AlertProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.95);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, {
        duration: 250,
        easing: Easing.out(Easing.ease),
      });
      scale.value = withTiming(1, {
        duration: 250,
        easing: Easing.out(Easing.ease),
      });
    } else {
      opacity.value = withTiming(0, {
        duration: 200,
        easing: Easing.in(Easing.ease),
      });
      scale.value = withTiming(0.95, {
        duration: 200,
        easing: Easing.in(Easing.ease),
      });
    }
  }, [visible, opacity, scale]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Default buttons if none provided
  const alertButtons = buttons.length > 0 ? buttons : [{ text: 'OK', style: 'default' as const }];

  // Separate cancel and other buttons
  const cancelButton = alertButtons.find(btn => btn.style === 'cancel');
  const otherButtons = alertButtons.filter(btn => btn.style !== 'cancel');

  const handleButtonPress = (button: AlertButton) => {
    button.onPress?.();
    onDismiss();
  };

  const separatorColor = colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';

  const renderButton = (button: AlertButton, index: number, isLast: boolean, showBorder: boolean) => {
    const isDestructive = button.style === 'destructive';
    const isCancel = button.style === 'cancel';
    const isDefault = button.style === 'default' || !button.style;

    // Add margin for gaps between buttons (vertical layout)
    const buttonGap = 12;
    const marginStyle = index > 0 ? { marginTop: buttonGap } : {};

    // Determine button background color with more transparent effect
    let backgroundColor: string;
    let textColor: string;
    
    if (isDestructive) {
      backgroundColor = colorScheme === 'dark' ? 'rgba(255, 59, 48, 0.3)' : 'rgba(255, 59, 48, 0.25)';
      textColor = '#FF3B30';
    } else if (isCancel) {
      backgroundColor = colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
      textColor = colorScheme === 'dark' ? '#FFFFFF' : '#000000';
    } else {
      // Default button - use more transparent blue
      backgroundColor = colorScheme === 'dark' ? 'rgba(10, 132, 255, 0.3)' : 'rgba(0, 122, 255, 0.25)';
      textColor = colorScheme === 'dark' ? '#0A84FF' : '#007AFF';
    }

    return (
      <BlurView
        intensity={50}
        tint={colorScheme === 'dark' ? 'dark' : 'light'}
        style={[
          styles.button,
          { borderRadius: 18 },
          marginStyle,
        ]}
      >
        <TouchableOpacity
          key={index}
          style={[
            styles.buttonInner,
            { backgroundColor },
          ]}
          onPress={() => handleButtonPress(button)}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.buttonText,
              { color: textColor, fontWeight: '600' },
            ]}
          >
            {button.text}
          </Text>
        </TouchableOpacity>
      </BlurView>
    );
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onDismiss}
    >
      <Animated.View
        style={[
          styles.overlay,
          overlayStyle,
        ]}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onDismiss}
        />
        <Animated.View
          style={[
            styles.alertContainer,
            {
              marginTop: insets.top,
              marginBottom: insets.bottom,
              marginLeft: insets.left,
              marginRight: insets.right,
            },
            containerStyle,
          ]}
          pointerEvents="box-none"
        >
          <BlurView
            intensity={100}
            tint={colorScheme === 'dark' ? 'dark' : 'light'}
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={[
              styles.alertContent,
              {
                backgroundColor: colorScheme === 'dark' 
                  ? 'rgba(28, 28, 30, 0.95)' 
                  : 'rgba(248, 249, 250, 0.95)',
              },
            ]}
          >
            {/* Content Section */}
            <ScrollView 
              style={styles.contentScrollView}
              contentContainerStyle={styles.contentSection}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {/* Title */}
              <Text style={[styles.title, { color: colors.text }]}>{title}</Text>

              {/* Message */}
              {message && (
                <Text style={[styles.message, { color: colors.secondaryText }]}>{message}</Text>
              )}
            </ScrollView>

            {/* Button Section */}
            <View style={styles.buttonSection}>
              {otherButtons.map((button, index) => {
                const isLast = index === otherButtons.length - 1 && !cancelButton;
                const showBorder = index > 0;
                return renderButton(button, index, isLast, showBorder);
              })}
              {cancelButton && renderButton(cancelButton, otherButtons.length, true, otherButtons.length > 0)}
            </View>
          </BlurView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const { width, height } = Dimensions.get('window');
const maxWidth = Math.min(width - 60, 320);
const maxHeight = height * 0.7; // Max 70% of screen height

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertContainer: {
    width: maxWidth,
    maxWidth: '85%',
    maxHeight: maxHeight,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  alertContent: {
    borderRadius: 14,
    overflow: 'hidden',
    maxHeight: maxHeight,
    flexDirection: 'column',
  },
  contentScrollView: {
    flexShrink: 1,
    maxHeight: maxHeight - 120, // Reserve space for buttons and padding
  },
  contentSection: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'center',
    letterSpacing: -0.2,
    width: '100%',
  },
  message: {
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: -0.1,
    width: '100%',
    flexShrink: 1,
  },
  buttonSection: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    flexDirection: 'column',
  },
  button: {
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
    borderWidth: 0,
  },
  buttonInner: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
    borderWidth: 0,
  },
  buttonText: {
    fontSize: 15,
    letterSpacing: -0.2,
  },
});

