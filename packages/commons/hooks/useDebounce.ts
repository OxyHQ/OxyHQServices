import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `delay`
 * milliseconds have elapsed without a change.
 *
 * Intended for feeding rapidly-changing inputs (e.g. a search box) into a
 * React Query key, so the query refetches once typing settles instead of on
 * every keystroke. The `useEffect` here is the canonical, justified use case
 * for the hook — debouncing is a time-based side effect that cannot be derived
 * synchronously during render.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);

  return debouncedValue;
}
