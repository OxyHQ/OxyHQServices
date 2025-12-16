import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard, ScreenHeader, useAlert } from '@/components/ui';
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
  const alert = useAlert();
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
      alert(
        'Cannot remove current device',
        'You cannot remove your current device. Please use another device to remove this one.',
        [{ text: 'OK' }]
      );
      return;
    }

    alert(
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
              alert('Error', 'Service unavailable. Please try again.');
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
                alert('Success', 'Device removed successfully');
              }
            } catch (err: any) {
              console.error('Failed to remove device:', err);
              alert('Error', err?.message || 'Failed to remove device. Please try again.');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  }, [device, deviceId, oxyServices, router, alert]);

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
        icon: getDeviceIcon(deviceType) as any,
        iconColor: isCurrent ? '#34C759' : colors.sidebarIconDevices,
        title: deviceName,
        subtitle: isCurrent ? 'Current Device' : 'Other Device',
        customIcon: (
          <View style={[styles.deviceIconBadge, { backgroundColor: isCurrent ? '#34C75920' : colors.sidebarIconDevices + '20' }]}>
            <MaterialCommunityIcons
              name={getDeviceIcon(deviceType) as any}
              size={24}
              color={isCurrent ? '#34C759' : colors.sidebarIconDevices}
            />
          </View>
        ),
      },
      {
        id: 'type',
        icon: 'devices' as any,
        iconColor: colors.sidebarIconDevices,
        title: 'Device Type',
        subtitle: deviceType.charAt(0).toUpperCase() + deviceType.slice(1),
      },
      {
        id: 'lastActive',
        icon: 'clock-outline' as any,
        iconColor: colors.sidebarIconDevices,
        title: 'Last Active',
        subtitle: lastActive ? formatRelativeTime(lastActive) : 'Unknown',
      },
      ...(createdAt ? [{
        id: 'createdAt',
        icon: 'calendar-outline' as any,
        iconColor: colors.sidebarIconDevices,
        title: 'First Seen',
        subtitle: formatDate(createdAt),
      }] : []),
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
            <AccountCard>
              <View style={styles.emptyStateContainer}>
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={40}
                  color={colors.text}
                  style={styles.emptyStateIcon}
                />
                <ThemedText style={[styles.emptyStateTitle, { color: colors.text }]}>
                  {error || 'Device not found'}
                </ThemedText>
                <ThemedText style={[styles.emptyStateSubtitle, { color: colors.text }]}>
                  The device you&apos;re looking for doesn&apos;t exist or has been removed
                </ThemedText>
                <TouchableOpacity
                  style={[styles.backButton, { backgroundColor: colors.tint }]}
                  onPressIn={handlePressIn}
                  onPress={() => router.back()}
                >
                  <Text style={styles.backButtonText}>Go Back</Text>
                </TouchableOpacity>
              </View>
            </AccountCard>
          </View>
        </View>
      </ScreenContentWrapper>
    );
  }

  const renderContent = () => {
    const isCurrent = Boolean(device?.isCurrent);

    return (
      <>
        <Section title="Device Information">
          <AccountCard>
            <GroupedSection items={deviceInfoItems} />
          </AccountCard>
        </Section>

        {!isCurrent && (
          <Section title="Device Actions">
            <ThemedText style={styles.sectionSubtitle}>
              Manage this device and its active sessions
            </ThemedText>
            <AccountCard>
              <GroupedSection items={[{
                id: 'remove-device',
                icon: 'delete-outline',
                iconColor: '#FF3B30',
                title: 'Remove Device',
                subtitle: 'Sign out all sessions on this device',
                onPress: handleRemoveDevice,
                showChevron: false,
                disabled: actionLoading,
                customContent: actionLoading ? (
                  <ActivityIndicator size="small" color="#FF3B30" />
                ) : undefined,
              }]} />
            </AccountCard>
          </Section>
        )}
      </>
    );
  };

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
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  emptyStateIcon: {
    opacity: 0.4,
    marginBottom: 12,
  },
  emptyStateTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
    opacity: 0.8,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontSize: 13,
    opacity: 0.6,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  backButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 8,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionSubtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
  deviceIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

