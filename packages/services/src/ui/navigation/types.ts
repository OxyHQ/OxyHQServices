import { OxyServices } from '../../core';
import { User } from '../../models/interfaces';
import { ComponentType, ReactNode } from 'react';
import { BottomSheetModalRef } from '../components/bottomSheet';

/**
 * Base props for all screens in the Oxy UI system
 */
export interface BaseScreenProps {
  oxyServices: OxyServices;
  navigate: (screen: string, props?: any) => void;
  goBack: () => void;
  onClose?: () => void;
  onAuthenticated?: (user: User) => void;
  theme: 'light' | 'dark';
  containerWidth?: number;
}

/**
 * Route configuration for OxyRouter
 */
export interface RouteConfig {
  component: ComponentType<any>;
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
  adjustSnapPoints: (snapPoints: string[]) => void;
  navigationRef?: React.MutableRefObject<((screen: string, props?: Record<string, any>) => void) | null>;
  containerWidth?: number;
}

/**
 * Props for the OxyProvider component
 */
export interface OxyProviderProps {
  /**
   * Instance of OxyServices
   */
  oxyServices: OxyServices;
  
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
  bottomSheetRef?: React.RefObject<any>;
  
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
   * Storage key prefix for AsyncStorage
   */
  storageKeyPrefix?: string;

  /**
   * Whether to show the internal toaster
   * @default true
   */
  showInternalToaster?: boolean;

  /**
   * External Redux store to use instead of the internal store
   * If provided, the store must include the Oxy reducers using setupOxyStore()
   * @example
   * ```ts
   * const store = configureStore({
   *   reducer: {
   *     ...setupOxyStore(),
   *     myAppReducer,
   *   },
   * });
   * ```
   */
  store?: any;

  /**
   * Skip Redux Provider wrapper if store is managed externally
   * Set to true if your app already has a Redux Provider higher in the component tree
   * @default false
   */
  skipReduxProvider?: boolean;
}
