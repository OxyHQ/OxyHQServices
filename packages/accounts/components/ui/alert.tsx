import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
  Animated,
  Dimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
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
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 65,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.95,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, fadeAnim, scaleAnim]);

  // Default buttons if none provided
  const alertButtons = buttons.length > 0 ? buttons : [{ text: 'OK', style: 'default' as const }];

  // Separate cancel and other buttons
  const cancelButton = alertButtons.find(btn => btn.style === 'cancel');
  const otherButtons = alertButtons.filter(btn => btn.style !== 'cancel');
  
  // Determine if we should use horizontal layout (2 buttons) or vertical (3+ buttons)
  const totalButtons = alertButtons.length;
  const useHorizontalLayout = totalButtons === 2 && cancelButton && otherButtons.length === 1;

  const handleButtonPress = (button: AlertButton) => {
    button.onPress?.();
    onDismiss();
  };

  const renderButton = (button: AlertButton, index: number, isLast: boolean, showBorder: boolean) => {
    const isDestructive = button.style === 'destructive';
    const isCancel = button.style === 'cancel';
    const isDefault = button.style === 'default' || !button.style;
    const separatorColor = colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';

    return (
      <View key={index} style={useHorizontalLayout && styles.buttonWrapper}>
        {showBorder && !useHorizontalLayout && (
          <View
            style={[
              styles.buttonSeparator,
              { backgroundColor: separatorColor },
            ]}
          />
        )}
        <TouchableOpacity
          style={[
            styles.button,
            useHorizontalLayout && styles.buttonHorizontal,
            useHorizontalLayout && index === 0 && styles.buttonHorizontalFirst,
          ]}
          onPress={() => handleButtonPress(button)}
          activeOpacity={0.6}
        >
          <Text
            style={[
              styles.buttonText,
              isCancel && { color: colors.sidebarItemActiveText, fontWeight: '600' },
              isDefault && { color: colors.sidebarItemActiveText, fontWeight: '600' },
              isDestructive && { color: '#FF3B30', fontWeight: '600' },
            ]}
          >
            {button.text}
          </Text>
        </TouchableOpacity>
        {useHorizontalLayout && index === 0 && (
          <View
            style={[
              styles.verticalSeparator,
              { backgroundColor: separatorColor },
            ]}
          />
        )}
      </View>
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
          {
            opacity: fadeAnim,
          },
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
              transform: [{ scale: scaleAnim }],
            },
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
            <View style={styles.contentSection}>
              {/* Title */}
              <Text style={[styles.title, { color: colors.text }]}>{title}</Text>

              {/* Message */}
              {message && (
                <Text style={[styles.message, { color: colors.secondaryText }]}>{message}</Text>
              )}
            </View>

            {/* Button Section */}
            <View
              style={[
                styles.buttonSection,
                useHorizontalLayout && styles.buttonSectionHorizontal,
                {
                  borderTopColor: colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                },
              ]}
            >
              {useHorizontalLayout ? (
                <>
                  {cancelButton && renderButton(cancelButton, 0, false, false)}
                  {otherButtons.map((button, index) => renderButton(button, index + 1, index === otherButtons.length - 1, false))}
                </>
              ) : (
                <>
                  {otherButtons.map((button, index) => {
                    const isLast = index === otherButtons.length - 1 && !cancelButton;
                    const showBorder = index > 0;
                    return renderButton(button, index, isLast, showBorder);
                  })}
                  {cancelButton && renderButton(cancelButton, otherButtons.length, true, otherButtons.length > 0)}
                </>
              )}
            </View>
          </BlurView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const { width } = Dimensions.get('window');
const maxWidth = Math.min(width - 60, 320);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertContainer: {
    width: maxWidth,
    maxWidth: '85%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  alertContent: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  contentSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  message: {
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: -0.1,
  },
  buttonSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  buttonSectionHorizontal: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  buttonWrapper: {
    flex: 1,
    position: 'relative',
  },
  buttonHorizontal: {
    flex: 1,
  },
  buttonHorizontalFirst: {
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  buttonSeparator: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
  verticalSeparator: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
  },
  buttonText: {
    fontSize: 17,
    letterSpacing: -0.2,
  },
});

