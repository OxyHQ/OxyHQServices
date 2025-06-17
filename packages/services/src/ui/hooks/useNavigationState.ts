import { useRef, useCallback, useState } from 'react';

interface NavigationStateHook {
  isNavigating: boolean;
  canNavigate: () => boolean;
  startNavigation: () => void;
  endNavigation: () => void;
  debounceNavigation: (callback: () => void, delay?: number) => void;
}

const DEFAULT_DEBOUNCE_MS = 150;

/**
 * Hook to manage navigation state and prevent transition conflicts
 * Helps coordinate bottom sheet animations with screen transitions
 */
export const useNavigationState = (): NavigationStateHook => {
  const [isNavigating, setIsNavigating] = useState(false);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNavigationRef = useRef<number>(0);

  const canNavigate = useCallback(() => {
    const now = Date.now();
    return !isNavigating && (now - lastNavigationRef.current) > DEFAULT_DEBOUNCE_MS;
  }, [isNavigating]);

  const startNavigation = useCallback(() => {
    setIsNavigating(true);
    lastNavigationRef.current = Date.now();
  }, []);

  const endNavigation = useCallback(() => {
    setIsNavigating(false);
  }, []);

  const debounceNavigation = useCallback((callback: () => void, delay = DEFAULT_DEBOUNCE_MS) => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      if (canNavigate()) {
        startNavigation();
        callback();
        
        // Auto end navigation after a reasonable time
        setTimeout(endNavigation, delay);
      }
    }, delay);
  }, [canNavigate, startNavigation, endNavigation]);

  return {
    isNavigating,
    canNavigate,
    startNavigation,
    endNavigation,
    debounceNavigation,
  };
};

export default useNavigationState;
