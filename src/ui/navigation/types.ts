import { OxyServices } from '../../core';
import { User } from '../../models/interfaces';
import { ComponentType, ReactNode } from 'react';

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
}
