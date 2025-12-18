import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface AuthFlowContextValue {
  error: string | null;
  isSigningIn: boolean;
  setAuthError: (error: string | null) => void;
  setSigningIn: (signingIn: boolean) => void;
  usernameRef: React.MutableRefObject<string>;
}

const AuthFlowContext = createContext<AuthFlowContextValue | undefined>(undefined);

/**
 * Provider for sharing auth flow state across screens
 */
export function AuthFlowProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const usernameRef = React.useRef<string>('');

  const setAuthError = useCallback((errorMessage: string | null) => {
    setError(errorMessage);
  }, []);

  const setSigningIn = useCallback((signingIn: boolean) => {
    setIsSigningIn(signingIn);
  }, []);

  return (
    <AuthFlowContext.Provider
      value={{
        error,
        isSigningIn,
        setAuthError,
        setSigningIn,
        usernameRef,
      }}
    >
      {children}
    </AuthFlowContext.Provider>
  );
}

/**
 * Hook to access auth flow context
 */
export function useAuthFlowContext(): AuthFlowContextValue {
  const context = useContext(AuthFlowContext);
  if (!context) {
    throw new Error('useAuthFlowContext must be used within AuthFlowProvider');
  }
  return context;
}

