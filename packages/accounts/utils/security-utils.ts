import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SecurityEventType, SecurityEventSeverity, SecurityActivity } from '@oxyhq/services';

/**
 * Get icon name for security event type
 */
export function getEventIcon(eventType: SecurityEventType): keyof typeof MaterialCommunityIcons.glyphMap {
  switch (eventType) {
    case 'sign_in':
      return 'login';
    case 'sign_out':
      return 'logout';
    case 'email_changed':
      return 'email-edit';
    case 'profile_updated':
      return 'account-edit';
    case 'device_added':
      return 'devices';
    case 'device_removed':
      return 'devices-off';
    case 'account_recovery':
      return 'key-variant';
    case 'security_settings_changed':
      return 'shield-edit';
    case 'suspicious_activity':
      return 'alert-circle';
    default:
      return 'shield-check';
  }
}

/**
 * Get color for security event type
 */
export function getEventColor(eventType: SecurityEventType, colorScheme: 'light' | 'dark'): string {
  const colors = {
    light: {
      sign_in: '#34C759',
      sign_out: '#8E8E93',
      email_changed: '#FF9500',
      profile_updated: '#5AC8FA',
      device_added: '#007AFF',
      device_removed: '#FF3B30',
      account_recovery: '#AF52DE',
      security_settings_changed: '#5856D6',
      suspicious_activity: '#FF3B30',
    },
    dark: {
      sign_in: '#30D158',
      sign_out: '#8E8E93',
      email_changed: '#FF9F0A',
      profile_updated: '#64D2FF',
      device_added: '#0A84FF',
      device_removed: '#FF453A',
      account_recovery: '#BF5AF2',
      security_settings_changed: '#5E5CE6',
      suspicious_activity: '#FF453A',
    },
  };

  return colors[colorScheme][eventType] || colors[colorScheme].sign_in;
}

/**
 * Format event description with metadata
 */
export function formatEventDescription(activity: SecurityActivity): string {
  const { eventType, eventDescription, metadata } = activity;

  // For device-related events, include device name if available
  if ((eventType === 'device_added' || eventType === 'device_removed') && metadata?.deviceName) {
    return `${eventDescription} (${metadata.deviceName})`;
  }

  // For email changes, show the change
  if (eventType === 'email_changed' && metadata?.oldValue && metadata?.newValue) {
    return `Email changed from ${metadata.oldValue} to ${metadata.newValue}`;
  }

  // For profile updates, show which fields were updated
  if (eventType === 'profile_updated' && metadata?.updatedFields) {
    const fields = Array.isArray(metadata.updatedFields) 
      ? metadata.updatedFields.join(', ')
      : String(metadata.updatedFields);
    return `Profile updated: ${fields}`;
  }

  return eventDescription;
}

/**
 * Get severity level for event
 */
export function getEventSeverity(eventType: SecurityEventType): SecurityEventSeverity {
  switch (eventType) {
    case 'sign_in':
    case 'sign_out':
    case 'profile_updated':
      return 'low';
    case 'email_changed':
    case 'device_added':
    case 'device_removed':
    case 'security_settings_changed':
      return 'medium';
    case 'account_recovery':
      return 'high';
    case 'suspicious_activity':
      return 'critical';
    default:
      return 'low';
  }
}

