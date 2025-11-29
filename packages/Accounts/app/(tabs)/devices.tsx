import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy, OxySignInButton } from '@oxyhq/services';
import { formatDate } from '@/utils/date-utils';
import { useHapticPress } from '@/hooks/use-haptic-press';

interface Device {
  id?: string;
  deviceId?: string;
  name?: string;
  deviceName?: string;
  type?: string;
  deviceType?: string;
  lastActive?: string;
  createdAt?: string;
  isCurrent?: boolean;
}

export default function DevicesScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  // OxyServices integration
  const { oxyServices, isAuthenticated, isLoading: oxyLoading, showBottomSheet } = useOxy();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch devices when authenticated
  useEffect(() => {
    const fetchDevices = async () => {
      if (!isAuthenticated || !oxyServices) return;

      setLoading(true);
      setError(null);
      try {
        const devicesData = await oxyServices.getUserDevices();
        
        // Debug logging to verify data consistency
        console.log('[Devices Screen] Fetched devices:', {
          count: devicesData?.length || 0,
          deviceIds: devicesData?.map((d: any) => d.deviceId || d.id),
          devices: devicesData,
        });
        
        setDevices(devicesData || []);
      } catch (err: any) {
        console.error('Failed to fetch devices:', err);
        setError(err?.message || 'Failed to load devices');
      } finally {
        setLoading(false);
      }
    };

    fetchDevices();
  }, [isAuthenticated, oxyServices]);

  const handlePressIn = useHapticPress();

  // Handle sign in
  const handleSignIn = useCallback(() => {
    if (showBottomSheet) {
      showBottomSheet('SignIn');
    }
  }, [showBottomSheet]);

  // Format relative time for last active
  const formatRelativeTime = useCallback((dateString?: string) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return formatDate(dateString);
  }, []);

  // Get device icon based on type
  const getDeviceIcon = useCallback((deviceType?: string): string => {
    if (!deviceType) return 'devices';
    const type = deviceType.toLowerCase();
    if (type.includes('mobile') || type.includes('phone') || type.includes('iphone') || type.includes('android')) {
      return 'cellphone';
    }
    if (type.includes('tablet') || type.includes('ipad')) {
      return 'tablet';
    }
    if (type.includes('desktop') || type.includes('laptop') || type.includes('mac') || type.includes('windows') || type.includes('linux')) {
      return 'laptop';
    }
    return 'devices';
  }, []);

  // Handle device removal
  const handleRemoveDevice = useCallback(async (deviceId: string, deviceName: string, isCurrent: boolean) => {
    if (isCurrent) {
      Alert.alert(
        'Cannot remove current device',
        'You cannot remove your current device. Please use another device to remove this one.',
        [{ text: 'OK' }]
      );
      return;
    }

    Alert.alert(
      'Remove device',
      `Are you sure you want to remove "${deviceName}"? This will sign out all sessions on this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setActionLoading(deviceId);
              await oxyServices?.removeDevice(deviceId);
              // Refresh devices list
              const devicesData = await oxyServices?.getUserDevices();
              setDevices(devicesData || []);
              if (Platform.OS === 'web') {
                console.log('Device removed successfully');
              } else {
                Alert.alert('Success', 'Device removed successfully');
              }
            } catch (err: any) {
              console.error('Failed to remove device:', err);
              Alert.alert('Error', err?.message || 'Failed to remove device. Please try again.');
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  }, [oxyServices]);

  // Transform devices for UI
  const deviceItems = useMemo(() => {
    if (!devices || devices.length === 0) return [];

    return devices.map((device: Device) => {
      const deviceId = device.id || device.deviceId || '';
      const deviceName = device.name || device.deviceName || 'Unknown Device';
      const deviceType = device.type || device.deviceType || '';
      const lastActive = device.lastActive || device.createdAt;
      // Use isCurrent from API response (already identified by backend)
      const isCurrent = Boolean(device.isCurrent);
      const isLoading = actionLoading === deviceId;

      return {
        id: deviceId,
        icon: getDeviceIcon(deviceType) as any,
        iconColor: isCurrent ? colors.tint : colors.sidebarIconDevices,
        title: deviceName,
        subtitle: isCurrent
          ? 'This device • Last active: ' + formatRelativeTime(lastActive)
          : 'Last active: ' + formatRelativeTime(lastActive),
        customContent: (
          <View style={styles.deviceActions}>
            {isCurrent ? (
              <View style={[styles.currentBadge, { backgroundColor: colors.tint }]}>
                <Text style={[styles.currentBadgeText, { color: '#FFFFFF' }]}>Current</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.removeButton, { backgroundColor: colors.card }]}
                onPressIn={handlePressIn}
                onPress={() => handleRemoveDevice(deviceId, deviceName, isCurrent)}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Text style={[styles.buttonText, { color: colors.text }]}>Remove</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        ),
      };
    });
  }, [devices, colors, formatRelativeTime, getDeviceIcon, actionLoading, handleRemoveDevice, handlePressIn]);

  // Show loading state
  if (oxyLoading || loading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>Loading devices...</ThemedText>
        </View>
      </ScreenContentWrapper>
    );
  }

  // Show message if not authenticated
  if (!isAuthenticated) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={styles.mobileContent}>
            <ScreenHeader title="Your devices" subtitle="Manage devices that have access to your account." />
            <View style={styles.unauthenticatedPlaceholder}>
              <ThemedText style={[styles.placeholderText, { color: colors.text }]}>
                Please sign in to view your devices.
              </ThemedText>
              <View style={styles.signInButtonWrapper}>
                <OxySignInButton />
                {showBottomSheet && (
                  <TouchableOpacity
                    style={[styles.alternativeSignInButton, { backgroundColor: colors.card, borderColor: colors.tint }]}
                    onPressIn={handlePressIn}
                    onPress={handleSignIn}
                  >
                    <Text style={[styles.alternativeSignInText, { color: colors.tint }]}>
                      Sign in with username
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </View>
      </ScreenContentWrapper>
    );
  }

  // Show error state
  if (error) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={styles.mobileContent}>
            <ScreenHeader title="Your devices" subtitle="Manage devices that have access to your account." />
            <View style={styles.errorContainer}>
              <ThemedText style={[styles.errorText, { color: colors.text }]}>
                {error}
              </ThemedText>
              <TouchableOpacity
                style={[styles.retryButton, { backgroundColor: colors.tint }]}
                onPressIn={handlePressIn}
                onPress={() => {
                  setError(null);
                  if (oxyServices) {
                    setLoading(true);
                    oxyServices.getUserDevices()
                      .then((devicesData) => {
                        setDevices(devicesData || []);
                        setLoading(false);
                      })
                      .catch((err) => {
                        setError(err?.message || 'Failed to load devices');
                        setLoading(false);
                      });
                  }
                }}
              >
                <Text style={[styles.retryButtonText, { color: '#FFFFFF' }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScreenContentWrapper>
    );
  }

  if (isDesktop) {
    return (
      <>
        <ScreenHeader title="Your devices" subtitle="Manage devices that have access to your account." />
        {deviceItems.length === 0 ? (
          <View style={styles.placeholder}>
            <ThemedText style={[styles.placeholderText, { color: colors.icon }]}>
              No devices found.
            </ThemedText>
          </View>
        ) : (
          <AccountCard>
            <GroupedSection items={deviceItems} />
          </AccountCard>
        )}
      </>
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
          <ScreenHeader title="Your devices" subtitle="Manage devices that have access to your account." />
          {deviceItems.length === 0 ? (
            <View style={styles.placeholder}>
              <ThemedText style={[styles.placeholderText, { color: colors.icon }]}>
                No devices found.
              </ThemedText>
            </View>
          ) : (
            <AccountCard>
              <GroupedSection items={deviceItems} />
            </AccountCard>
          )}
        </View>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  desktopBody: {
    flex: 1,
    flexDirection: 'row',
  },
  desktopSidebar: {
    width: 260,
    padding: 20,
  },
  desktopHeader: {
    marginBottom: 24,
  },
  welcomeText: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 4,
  },
  welcomeSubtext: {
    fontSize: 13,
    opacity: 0.6,
  },
  menuContainer: {
    gap: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 26,
    gap: 12,
  },
  menuItemActive: {},
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '400',
  },
  desktopMain: {
    flex: 1,
    maxWidth: 720,
  },
  desktopMainContent: {
    padding: 32,
  },
  headerSection: {
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.6,
  },
  accountCard: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  mobileContent: {
    padding: 16,
    paddingBottom: 120,
  },
  mobileHeaderSection: {
    marginBottom: 20,
  },
  mobileTitle: {
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 6,
  },
  mobileSubtitle: {
    fontSize: 15,
    opacity: 0.6,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    opacity: 0.7,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  placeholderText: {
    fontSize: 16,
    textAlign: 'center',
  },
  deviceActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  currentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  currentBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  removeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  unauthenticatedPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 24,
  },
  signInButtonWrapper: {
    width: '100%',
    maxWidth: 300,
    gap: 12,
    marginTop: 16,
  },
  alternativeSignInButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alternativeSignInText: {
    fontSize: 14,
    fontWeight: '500',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    opacity: 0.7,
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});