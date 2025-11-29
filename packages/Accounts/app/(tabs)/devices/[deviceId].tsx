import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { AccountCard, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';
import { useOxy } from '@oxyhq/services';
import { formatDate } from '@/utils/date-utils';
import { useHapticPress } from '@/hooks/use-haptic-press';
import { MaterialCommunityIcons } from '@expo/vector-icons';

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

export default function DeviceDetailScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();
  const router = useRouter();
  const params = useLocalSearchParams<{ deviceId: string }>();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  // OxyServices integration
  const { oxyServices, isAuthenticated, isLoading: oxyLoading } = useOxy();
  const [device, setDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const deviceId = params.deviceId;

  // Fetch device details
  useEffect(() => {
    const fetchDevice = async () => {
      if (!isAuthenticated || !oxyServices || !deviceId) return;

      setLoading(true);
      setError(null);
      try {
        const devicesData = await oxyServices.getUserDevices();
        const foundDevice = devicesData?.find(
          (d: Device) => (d.id === deviceId || d.deviceId === deviceId)
        );

        if (foundDevice) {
          setDevice(foundDevice);
        } else {
          setError('Device not found');
        }
      } catch (err: any) {
        console.error('Failed to fetch device:', err);
        setError(err?.message || 'Failed to load device');
      } finally {
        setLoading(false);
      }
    };

    fetchDevice();
  }, [isAuthenticated, oxyServices, deviceId]);

  const handlePressIn = useHapticPress();

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
  const handleRemoveDevice = useCallback(async () => {
    if (!device || !oxyServices) return;

    const deviceName = device.name || device.deviceName || 'Unknown Device';
    const isCurrent = Boolean(device.isCurrent);

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
            // Explicitly check if oxyServices exists before attempting operations
            if (!oxyServices) {
              console.error('Failed to remove device: oxyServices is not available');
              Alert.alert('Error', 'Service unavailable. Please try again.');
              return;
            }

            try {
              setActionLoading(true);
              await oxyServices.removeDevice(deviceId);
              // Navigate back to devices list after successful removal
              router.back();
              if (Platform.OS === 'web') {
                console.log('Device removed successfully');
              } else {
                Alert.alert('Success', 'Device removed successfully');
              }
            } catch (err: any) {
              console.error('Failed to remove device:', err);
              Alert.alert('Error', err?.message || 'Failed to remove device. Please try again.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  }, [device, deviceId, oxyServices, router]);

  // Device information items
  const deviceInfoItems = useMemo(() => {
    if (!device) return [];

    const deviceName = device.name || device.deviceName || 'Unknown Device';
    const deviceType = device.type || device.deviceType || 'unknown';
    const lastActive = device.lastActive || device.createdAt;
    const createdAt = device.createdAt;
    const isCurrent = Boolean(device.isCurrent);

    return [
      {
        id: 'name',
        icon: 'information-outline',
        iconColor: colors.tint,
        title: 'Device Name',
        subtitle: deviceName,
      },
      {
        id: 'type',
        icon: getDeviceIcon(deviceType) as any,
        iconColor: colors.sidebarIconDevices,
        title: 'Device Type',
        subtitle: deviceType.charAt(0).toUpperCase() + deviceType.slice(1),
      },
      {
        id: 'lastActive',
        icon: 'clock-outline',
        iconColor: colors.sidebarIconDevices,
        title: 'Last Active',
        subtitle: lastActive ? formatRelativeTime(lastActive) : 'Unknown',
      },
      ...(createdAt ? [{
        id: 'createdAt',
        icon: 'calendar-outline',
        iconColor: colors.sidebarIconDevices,
        title: 'First Seen',
        subtitle: formatDate(createdAt),
      }] : []),
      {
        id: 'status',
        icon: isCurrent ? 'check-circle' : 'circle-outline',
        iconColor: isCurrent ? '#34C759' : colors.sidebarIconDevices,
        title: 'Status',
        subtitle: isCurrent ? 'Current Device' : 'Other Device',
      },
    ];
  }, [device, colors, formatRelativeTime, getDeviceIcon]);

  // Show loading state
  if (oxyLoading || loading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>Loading device details...</ThemedText>
        </View>
      </ScreenContentWrapper>
    );
  }

  // Show message if not authenticated
  if (!isAuthenticated) {
    return (
      <UnauthenticatedScreen
        title="Device Details"
        subtitle="View and manage device information."
        message="Please sign in to view device details."
        isAuthenticated={isAuthenticated}
      />
    );
  }

  // Show error state
  if (error || !device) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <View style={styles.mobileContent}>
            <ScreenHeader title="Device Details" subtitle="View and manage device information." />
            <View style={styles.errorContainer}>
              <ThemedText style={[styles.errorText, { color: colors.text }]}>
                {error || 'Device not found'}
              </ThemedText>
              <TouchableOpacity
                style={[styles.retryButton, { backgroundColor: colors.tint }]}
                onPressIn={handlePressIn}
                onPress={() => router.back()}
              >
                <Text style={[styles.retryButtonText, { color: '#FFFFFF' }]}>Go Back</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScreenContentWrapper>
    );
  }

  const deviceName = device.name || device.deviceName || 'Unknown Device';
  const deviceType = device.type || device.deviceType || 'unknown';
  const isCurrent = Boolean(device.isCurrent);

  const renderContent = () => (
    <>
      <AccountCard>
        <View style={styles.deviceHeader}>
          <View style={[styles.deviceIconContainer, { backgroundColor: colors.card }]}>
            <MaterialCommunityIcons 
              name={getDeviceIcon(deviceType) as any} 
              size={48} 
              color={colors.tint} 
            />
          </View>
          <View style={styles.deviceHeaderText}>
            <ThemedText style={[styles.deviceName, { color: colors.text }]}>
              {deviceName}
            </ThemedText>
            {isCurrent && (
              <View style={[styles.currentBadge, { backgroundColor: colors.tint }]}>
                <Text style={[styles.currentBadgeText, { color: '#FFFFFF' }]}>Current Device</Text>
              </View>
            )}
          </View>
        </View>
      </AccountCard>

      <AccountCard>
        <View style={styles.infoSection}>
          <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>Device Information</ThemedText>
          {deviceInfoItems.map((item, index) => (
            <View 
              key={item.id} 
              style={[
                styles.infoItem,
                index < deviceInfoItems.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }
              ]}
            >
              <View style={styles.infoItemLeft}>
                <View style={[styles.infoIconContainer, { backgroundColor: item.iconColor + '20' }]}>
                  <MaterialCommunityIcons name={item.icon as any} size={20} color={item.iconColor} />
                </View>
                <View style={styles.infoItemText}>
                  <ThemedText style={[styles.infoItemTitle, { color: colors.text }]}>
                    {item.title}
                  </ThemedText>
                  <ThemedText style={[styles.infoItemSubtitle, { color: colors.secondaryText }]}>
                    {item.subtitle}
                  </ThemedText>
                </View>
              </View>
            </View>
          ))}
        </View>
      </AccountCard>

      {!isCurrent && (
        <View style={styles.actionSection}>
          <TouchableOpacity
            style={[styles.removeButton, { backgroundColor: '#FF3B30' }]}
            onPressIn={handlePressIn}
            onPress={handleRemoveDevice}
            disabled={actionLoading}
          >
            {actionLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <MaterialCommunityIcons name="delete-outline" size={20} color="#FFFFFF" />
                <Text style={styles.removeButtonText}>Remove Device</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </>
  );

  if (isDesktop) {
    return (
      <>
        <ScreenHeader title="Device Details" subtitle="View and manage device information." />
        {renderContent()}
      </>
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
          <ScreenHeader title="Device Details" subtitle="View and manage device information." />
          {renderContent()}
        </View>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  mobileContent: {
    padding: 16,
    paddingBottom: 120,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 40,
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
    marginTop: 16,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  deviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
  },
  deviceIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceHeaderText: {
    flex: 1,
    gap: 8,
  },
  deviceName: {
    fontSize: 24,
    fontWeight: '600',
  },
  currentBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  currentBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  infoSection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  infoItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  infoIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoItemText: {
    flex: 1,
  },
  infoItemTitle: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  infoItemSubtitle: {
    fontSize: 13,
    opacity: 0.7,
  },
  actionSection: {
    padding: 16,
  },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    gap: 8,
  },
  removeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

