import type { OxyServices } from '../../core';
import type { User } from '../../models/interfaces';
import type { ComponentType, ReactNode } from 'react';

/**
 * Base props for all screens in the Oxy UI system
 */
export interface BaseScreenProps {
  oxyServices: OxyServices;
  navigate: (screen: string, props?: Record<string, unknown>) => void;
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
export interface RouteConfig {
  component: ComponentType<any>; // Allow any component type for flexibility
  snapPoints: string[];
}

/**
 * Props for OxyRouter component
 */
export interface OxyRouterProps {
  oxyServices: OxyServices;
  initialScreen: string;
  onClose?: () => void;
  onAuthenticated?: (user: User) => void;
  theme: 'light' | 'dark';
  adjustSnapPoints?: (snapPoints: string[]) => void;
  navigationRef?: React.MutableRefObject<((screen: string, props?: Record<string, unknown>) => void) | null>;
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
  initialScreen?: 'SignIn' | 'SignUp' | 'AccountCenter';
  
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
   * @deprecated External bottom sheet ref is no longer required as OxyProvider handles the bottom sheet internally
   * @hidden
   */
  bottomSheetRef?: React.RefObject<unknown>;
  
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
}
