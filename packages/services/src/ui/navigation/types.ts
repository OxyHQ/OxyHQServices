import type { OxyServices } from '../../core';
import type { User } from '../../models/interfaces';
import type { ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { RouteName } from './routes';

/**
 * Base props for all screens in the Oxy UI system
 */
export interface BaseScreenProps {
  oxyServices: OxyServices;
  navigate: (screen: RouteName, props?: Record<string, unknown>) => void;
  goBack: () => void;
  onClose?: () => void;
  onAuthenticated?: (user: User) => void;
  theme: 'light' | 'dark';
  containerWidth?: number;
  initialStep?: number;
  username?: string;
  userProfile?: User;
}

/**
 * Route configuration for OxyRouter
 */
// Route config moved to routes.ts to avoid cycles; re-exported here if needed
export { routes } from './routes';
export type { RouteName } from './routes';

/**
 * Router controller interface for accessing router state
 */
export interface OxyRouterController {
  goBack: () => void;
  canGoBack: () => boolean;
}

/**
 * Props for OxyRouter component
 */
export interface OxyRouterProps {
  oxyServices: OxyServices;
  initialScreen: RouteName;
  onClose?: () => void;
  onAuthenticated?: (user: User) => void;
  theme: 'light' | 'dark';
  adjustSnapPoints?: (snapPoints: string[]) => void;
  navigationRef?: React.MutableRefObject<((screen: RouteName, props?: Record<string, unknown>) => void) | null>;
  routerRef?: React.MutableRefObject<OxyRouterController | null>;
  containerWidth?: number;
}

/**
 * Props for the OxyProvider component
 */
export interface OxyProviderProps {
  /**
   * Instance of OxyServices (optional if baseURL is provided)
   */
  oxyServices?: OxyServices;
  
  /**
   * API base URL for automatic service creation (optional if oxyServices is provided)
   */
  baseURL?: string;
  
  /**
   * Initial screen to display
   * @default "SignIn"
   */
  initialScreen?: RouteName;
  
  /**
   * Callback when the bottom sheet is closed
   */
  onClose?: () => void;
  
  /**
   * Callback when a user successfully authenticates
   */
  onAuthenticated?: (user: User) => void;
  
  /**
   * UI theme
   * @default "light"
   */
  theme?: 'light' | 'dark';
  
  /**
   * @internal
   * Reference to the bottom sheet component (for internal use only)
   * @hidden
   */
  bottomSheetRef?: React.RefObject<BottomSheetController | null>;
  
  /**
   * Whether to automatically present the bottom sheet when component mounts
   * @default false
   */
  autoPresent?: boolean;
  
  /**
   * Custom styles for the bottom sheet
   */
  customStyles?: {
    /**
     * Background color of the bottom sheet
     */
    backgroundColor?: string;
    
    /**
     * Color of the handle indicator
     */
    handleColor?: string;

    /**
     * Content padding
     */
    contentPadding?: number;
  };

  /**
   * Child components to render within the provider
   */
  children?: ReactNode;

  /**
   * When true, only provides the authentication context without rendering the bottom sheet UI
   * @default false
   */
  contextOnly?: boolean;

  /**
   * Callback when authentication state changes
   */
  onAuthStateChange?: (user: User | null) => void;

  /**
   * Prefix for keys in AsyncStorage
   * @default "oxy"
   */
  storageKeyPrefix?: string;

  /**
   * Whether to show the internal toaster in the bottom sheet
   * If false, only the provider's global toaster will be shown
   * @default true
   */
  showInternalToaster?: boolean;

  /**
   * Optional QueryClient instance for React Query. If not provided, a sensible default is created.
   */
  queryClient?: QueryClient;

  appInsets?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

// Typed imperative controller for the bottom sheet UI
export interface BottomSheetController {
  present: () => void;
  dismiss: () => void;
  expand: () => void;
  collapse: () => void;
  snapToIndex: (index: number) => void;
  snapToPosition: (position: number | string) => void;
  navigate: (screen: RouteName | string, props?: Record<string, any>) => void;
}
