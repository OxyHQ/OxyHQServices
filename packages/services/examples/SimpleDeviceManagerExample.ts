/**
 * Simple Device Manager Usage Example
 * 
 * This example demonstrates the DeviceManager utility usage
 * without JSX to avoid compilation issues in documentation.
 * For actual React components, use JSX as shown in WorkingDeviceExample.tsx
 */

import { 
  DeviceManager, 
  OxyServices,
  type DeviceFingerprint, 
  type StoredDeviceInfo 
} from '@oxyhq/services';

// Example 1: Basic Device Information
async function getDeviceInfo() {
  try {
    // Get device fingerprint
    const fingerprint: DeviceFingerprint = DeviceManager.getDeviceFingerprint();
    console.log('Device fingerprint:', fingerprint);
    
    // Get stored device info (creates new if doesn't exist)
    const deviceInfo: StoredDeviceInfo = await DeviceManager.getDeviceInfo();
    console.log('Device info:', deviceInfo);
    
    return deviceInfo;
  } catch (error) {
    console.error('Error getting device info:', error);
    return null;
  }
}

// Example 2: Update Device Name
async function updateDeviceName(newName: string) {
  try {
    await DeviceManager.updateDeviceName(newName);
    console.log('Device name updated successfully');
    
    // Get updated info
    const updatedInfo = await DeviceManager.getDeviceInfo();
    console.log('Updated device info:', updatedInfo);
  } catch (error) {
    console.error('Error updating device name:', error);
  }
}

// Example 3: Initialize OxyServices with Device Tracking
const oxyServices = new OxyServices({
  // Replace with your actual configuration
  apiKey: 'your-api-key-here',
  apiUrl: 'https://your-api-endpoint.com',
  enableDeviceTracking: true,
  maxDevicesPerUser: 5
});

// Example 4: Device Management in React Component (pseudo-code)
/*
import { useOxy, OxyProvider } from '@oxyhq/services';

function DeviceComponent() {
  const { user, isAuthenticated } = useOxy();
  const [deviceInfo, setDeviceInfo] = useState(null);
  
  useEffect(() => {
    async function loadDeviceInfo() {
      const info = await DeviceManager.getDeviceInfo();
      setDeviceInfo(info);
    }
    
    if (isAuthenticated) {
      loadDeviceInfo();
    }
  }, [isAuthenticated]);
  
  // ... component JSX
}

function App() {
  return (
    <OxyProvider oxyServices={oxyServices}>
      <DeviceComponent />
    </OxyProvider>
  );
}
*/

// Example usage
async function demonstrateDeviceManager() {
  console.log('=== Device Manager Demo ===');
  
  // Get initial device info
  const deviceInfo = await getDeviceInfo();
  
  if (deviceInfo) {
    console.log('Device ID:', deviceInfo.deviceId);
    console.log('Device Name:', deviceInfo.deviceName);
    console.log('Created:', deviceInfo.createdAt);
    console.log('Last Used:', deviceInfo.lastUsed);
    
    // Update device name
    await updateDeviceName('My Custom Device Name');
  }
}

export { demonstrateDeviceManager };

/**
 * Available DeviceManager Methods:
 * 
 * Static Methods:
 * - getDeviceFingerprint(): DeviceFingerprint
 * - getDeviceInfo(): Promise<StoredDeviceInfo>
 * - createNewDeviceInfo(): Promise<StoredDeviceInfo>
 * - saveDeviceInfo(deviceInfo: StoredDeviceInfo): Promise<void>
 * - updateDeviceName(deviceName: string): Promise<void>
 * - clearDeviceInfo(): Promise<void>
 * - getDefaultDeviceName(): string
 * 
 * Interfaces:
 * - DeviceFingerprint: { userAgent, platform, language?, timezone?, screen? }
 * - StoredDeviceInfo: { deviceId, deviceName?, fingerprint?, createdAt, lastUsed }
 * 
 * Usage Notes:
 * - DeviceManager works in both React Native and Web environments
 * - Uses AsyncStorage in React Native, localStorage in web
 * - Device fingerprinting is platform-aware
 * - Device IDs are persistent across app sessions
 */
