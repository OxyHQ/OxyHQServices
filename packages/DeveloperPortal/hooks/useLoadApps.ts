import { useEffect } from 'react';
import { useOxy } from '@oxyhq/services';
import { useAppStore } from '@/store/useAppStore';
import { Alert } from 'react-native';

/**
 * Hook to load and sync developer apps with Zustand store
 */
export function useLoadApps() {
  const { oxyServices, isAuthenticated } = useOxy();
  const { setApps, setLoading, setError } = useAppStore();

  useEffect(() => {
    if (!isAuthenticated || !oxyServices) {
      setApps([]);
      setLoading(false);
      return;
    }

    loadApps();
  }, [isAuthenticated, oxyServices]);

  const loadApps = async () => {
    if (!oxyServices) return;

    try {
      setLoading(true);
      setError(null);
      const apps = await oxyServices.getDeveloperApps();
      setApps(apps);
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to load apps';
      setError(errorMessage);
      
      // Only show alert for non-auth errors
      if (error.status !== 401 && error.statusCode !== 401) {
        Alert.alert('Error', errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  return { loadApps };
}
