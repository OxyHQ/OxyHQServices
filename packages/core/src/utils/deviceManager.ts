export interface DeviceFingerprint {
  userAgent: string;
  platform: string;
  language?: string;
  timezone?: string;
  screen?: {
    width: number;
    height: number;
    colorDepth: number;
  };
}

export interface StoredDeviceInfo {
  deviceId: string;
  deviceName?: string;
  fingerprint?: string;
  createdAt: string;
  lastUsed: string;
}

/**
 * Client-side device management utility
 * Handles persistent device identification across app sessions
 */
export class DeviceManager {
  private static DEVICE_KEY = 'oxy_device_info';
  
  /**
   * Check if we're in React Native environment
   */
  private static isReactNative(): boolean {
    return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
  }
  
  /**
   * Get appropriate storage for the platform
   */
  private static async getStorage(): Promise<{
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
  }> {
    if (this.isReactNative()) {
      try {
        const asyncStorageModule = await import('@react-native-async-storage/async-storage');
        const storage = (asyncStorageModule.default as unknown) as import('@react-native-async-storage/async-storage').AsyncStorageStatic;
        return {
          getItem: storage.getItem.bind(storage),
          setItem: storage.setItem.bind(storage),
          removeItem: storage.removeItem.bind(storage),
        };
      } catch (error) {
        console.error('AsyncStorage not available in React Native:', error);
        throw new Error('AsyncStorage is required in React Native environment');
      }
    } else {
      // Use localStorage for web
      return {
        getItem: async (key: string) => localStorage.getItem(key),
        setItem: async (key: string, value: string) => localStorage.setItem(key, value),
        removeItem: async (key: string) => localStorage.removeItem(key)
      };
    }
  }
  
  /**
   * Get or create device fingerprint for current device
   */
  static getDeviceFingerprint(): DeviceFingerprint {
    const fingerprint: DeviceFingerprint = {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
      language: typeof navigator !== 'undefined' ? navigator.language : undefined,
      timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
    };

    // Add screen info if available
    if (typeof screen !== 'undefined') {
      fingerprint.screen = {
        width: screen.width,
        height: screen.height,
        colorDepth: screen.colorDepth
      };
    }

    return fingerprint;
  }

  /**
   * Get stored device info or create new one
   */
  static async getDeviceInfo(): Promise<StoredDeviceInfo> {
    try {
      const storage = await this.getStorage();
      const stored = await storage.getItem(this.DEVICE_KEY);
      
      if (stored) {
        const deviceInfo: StoredDeviceInfo = JSON.parse(stored);
        
        // Update last used timestamp
        deviceInfo.lastUsed = new Date().toISOString();
        await this.saveDeviceInfo(deviceInfo);
        
        return deviceInfo;
      }
      
      // Create new device info
      return await this.createNewDeviceInfo();
    } catch (error) {
      console.error('Error getting device info:', error);
      return await this.createNewDeviceInfo();
    }
  }

  /**
   * Create new device info and store it
   */
  static async createNewDeviceInfo(): Promise<StoredDeviceInfo> {
    const deviceInfo: StoredDeviceInfo = {
      deviceId: this.generateDeviceId(),
      fingerprint: JSON.stringify(this.getDeviceFingerprint()),
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString()
    };

    await this.saveDeviceInfo(deviceInfo);
    return deviceInfo;
  }

  /**
   * Save device info to storage
   */
  static async saveDeviceInfo(deviceInfo: StoredDeviceInfo): Promise<void> {
    try {
      const storage = await this.getStorage();
      await storage.setItem(this.DEVICE_KEY, JSON.stringify(deviceInfo));
    } catch (error) {
      console.error('Error saving device info:', error);
    }
  }

  /**
   * Update device name
   */
  static async updateDeviceName(deviceName: string): Promise<void> {
    try {
      const deviceInfo = await this.getDeviceInfo();
      deviceInfo.deviceName = deviceName;
      await this.saveDeviceInfo(deviceInfo);
    } catch (error) {
      console.error('Error updating device name:', error);
    }
  }

  /**
   * Clear stored device info (useful for testing or reset)
   */
  static async clearDeviceInfo(): Promise<void> {
    try {
      const storage = await this.getStorage();
      await storage.removeItem(this.DEVICE_KEY);
    } catch (error) {
      console.error('Error clearing device info:', error);
    }
  }

  /**
   * Generate a unique device ID
   */
  private static generateDeviceId(): string {
    // Use crypto.getRandomValues if available, otherwise fallback to Math.random
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    } else {
      // Fallback for environments without crypto.getRandomValues
      return 'device_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
  }

  /**
   * Get a user-friendly device name based on platform
   */
  static getDefaultDeviceName(): string {
    const fingerprint = this.getDeviceFingerprint();
    const platform = (fingerprint.platform || '').toLowerCase();
    
    if (platform.includes('win')) return 'Windows Computer';
    if (platform.includes('mac')) return 'Mac Computer';
    if (platform.includes('linux')) return 'Linux Computer';
    if (platform.includes('iphone')) return 'iPhone';
    if (platform.includes('ipad')) return 'iPad';
    if (platform.includes('android')) return 'Android Device';
    
    return 'Unknown Device';
  }
}
