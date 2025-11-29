import React, { useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { LogoIcon } from '@/assets/logo';
import { LoadingSpinner } from '@/components/ui/Loading';
import { useTheme } from '@/hooks/useTheme';

interface AppSplashScreenProps {
  onFadeComplete?: () => void;
  startFade?: boolean;
}

const FADE_DURATION = 500;
const LOGO_SIZE = 100;
const SPINNER_SIZE = 28;

const AppSplashScreen: React.FC<AppSplashScreenProps> = ({
  onFadeComplete,
  startFade = false
}) => {
  const theme = useTheme();
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  const handleFadeComplete = useCallback(
    (finished: boolean) => {
      if (finished && onFadeComplete) {
        onFadeComplete();
      }
    },
    [onFadeComplete],
  );

  useEffect(() => {
    if (startFade) {
      // Cancel any existing animation
      animationRef.current?.stop();

      // Start fade out animation
      animationRef.current = Animated.timing(fadeAnim, {
        toValue: 0,
        duration: FADE_DURATION,
        useNativeDriver: true,
      });

      animationRef.current.start(({ finished }) => {
        handleFadeComplete(finished);
      });
    }

    return () => {
      animationRef.current?.stop();
    };
  }, [startFade, fadeAnim, handleFadeComplete]);

  // Memoized styles
  const backgroundColor = useMemo(
    () => theme?.mode === 'dark' ? '#000000' : '#ffffff',
    [theme?.mode]
  );

  const containerStyle = useMemo(
    () => [styles.container, { opacity: fadeAnim, backgroundColor }],
    [fadeAnim, backgroundColor]
  );

  // Spinner and logo colors - white on dark, black on light
  const iconColor = useMemo(
    () => theme?.mode === 'dark' ? '#ffffff' : '#000000',
    [theme?.mode]
  );

  return (
    <Animated.View style={containerStyle}>
      <View style={styles.content}>
        <View style={styles.logoContainer}>
          <LogoIcon
            height={LOGO_SIZE}
            useThemeColors={true}
            color={theme?.mode === 'dark' ? '#000000' : undefined}
          />
          <View style={styles.spinnerContainer}>
            <LoadingSpinner iconSize={SPINNER_SIZE} color={iconColor} showText={false} />
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerContainer: {
    marginTop: 32,
  },
});

export default React.memo(AppSplashScreen);
