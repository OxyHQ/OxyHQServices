/**
 * WebOxyProvider - OxyProvider for web apps (Next.js, React)
 *
 * This provider is specifically for web environments and doesn't include
 * React Native-specific dependencies. It provides:
 * - Automatic cross-domain SSO via FedCM (Chrome 108+, Safari 16.4+, Edge 108+)
 * - Session management
 * - All useOxy/useAuth functionality
 *
 * Zero-config: Just wrap your app and SSO works automatically across domains.
 *
 * Usage:
 * ```tsx
 * import { WebOxyProvider, useAuth } from '@oxyhq/services';
 *
 * function App() {
 *   return (
 *     <WebOxyProvider baseURL="https://api.oxy.so">
 *       <YourApp />
 *     </WebOxyProvider>
 *   );
 * }
 *
 * function LoginButton() {
 *   const { isAuthenticated, signIn, user } = useAuth();
 *   if (isAuthenticated) return <span>Welcome, {user?.username}!</span>;
 *   return <button onClick={() => signIn()}>Sign In</button>;
 * }
 * ```
 */

import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { OxyContextProvider } from '../context/OxyContext';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../hooks/queryClient';
import { createPlatformStorage, type StorageInterface } from '../utils/storageHelpers';

export interface WebOxyProviderProps {
  children: ReactNode;
  baseURL: string;
  authWebUrl?: string;
  onAuthStateChange?: (user: any) => void;
  storageKeyPrefix?: string;
  queryClient?: ReturnType<typeof createQueryClient>;
}

/**
 * OxyProvider for web applications
 *
 * Features:
 * - Automatic cross-domain SSO via FedCM (browser-native identity API)
 * - Works across different TLDs (alia.onl, mention.earth, homiio.com, etc.)
 * - Session persistence in localStorage
 * - TanStack Query for data fetching
 * - No React Native dependencies
 */
const WebOxyProvider: FC<WebOxyProviderProps> = ({
  children,
  baseURL,
  authWebUrl,
  onAuthStateChange,
  storageKeyPrefix,
  queryClient: providedQueryClient,
}) => {
  const storageRef = useRef<StorageInterface | null>(null);
  const queryClientRef = useRef<ReturnType<typeof createQueryClient> | null>(null);
  const [queryClient, setQueryClient] = useState<ReturnType<typeof createQueryClient> | null>(null);

  useEffect(() => {
    if (providedQueryClient) {
      queryClientRef.current = providedQueryClient;
      setQueryClient(providedQueryClient);
      return;
    }

    let mounted = true;
    createPlatformStorage()
      .then((storage) => {
        if (mounted && !queryClientRef.current) {
          storageRef.current = storage;
          const client = createQueryClient(storage);
          queryClientRef.current = client;
          setQueryClient(client);
        }
      })
      .catch(() => {
        if (mounted && !queryClientRef.current) {
          const client = createQueryClient(null);
          queryClientRef.current = client;
          setQueryClient(client);
        }
      });

    return () => {
      mounted = false;
    };
  }, [providedQueryClient]);

  // Wait for query client to be ready
  if (!queryClient) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <OxyContextProvider
        baseURL={baseURL}
        authWebUrl={authWebUrl}
        storageKeyPrefix={storageKeyPrefix}
        onAuthStateChange={onAuthStateChange}
      >
        {children}
      </OxyContextProvider>
    </QueryClientProvider>
  );
};

export default WebOxyProvider;
