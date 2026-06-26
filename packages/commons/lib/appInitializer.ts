/**
 * App Initialization Service
 *
 * Fonts are NOT loaded here: `BloomThemeProvider` applies Inter globally via
 * `Text.defaultProps`, and monospace surfaces use the platform `Fonts.mono`
 * stack — so there is no async font load to gate the splash on.
 */

import * as SplashScreen from 'expo-splash-screen';

export interface InitializationResult {
  success: boolean;
  error?: Error;
}

/**
 * Main app initialization function
 * Coordinates all initialization steps
 */
export class AppInitializer {
  /**
   * Initializes the entire app
   */
  static async initializeApp(): Promise<InitializationResult> {
    try {
      // Hide splash screen
      try {
        await SplashScreen.hideAsync();
      } catch (error) {
        console.warn('Failed to hide native splash screen:', error);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown initialization error'),
      };
    }
  }
}

