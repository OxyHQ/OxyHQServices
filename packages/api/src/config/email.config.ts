/**
 * Email Server Configuration
 *
 * Centralizes all email-related settings: domain, DKIM, S3 storage,
 * SMTP ports, spam filtering, and per-tier quota limits.
 */

import { getEnvVar, getEnvNumber, getEnvBoolean } from './env';

/** Primary email domain */
export const EMAIL_DOMAIN = getEnvVar('EMAIL_DOMAIN', 'oxy.so');

/** DKIM signing configuration */
export const DKIM_CONFIG = {
  domainName: EMAIL_DOMAIN,
  keySelector: getEnvVar('DKIM_SELECTOR', 'default'),
  /** PEM-encoded private key (set via env or file path) */
  privateKey: getEnvVar('DKIM_PRIVATE_KEY', ''),
};

/** S3 bucket dedicated to email attachments */
export const EMAIL_S3_CONFIG = {
  bucket: getEnvVar('EMAIL_S3_BUCKET', 'oxy-email'),
  region: getEnvVar('EMAIL_S3_REGION', getEnvVar('AWS_REGION', 'us-east-1')),
  accessKeyId: getEnvVar('EMAIL_S3_ACCESS_KEY_ID', getEnvVar('AWS_ACCESS_KEY_ID', '')),
  secretAccessKey: getEnvVar('EMAIL_S3_SECRET_ACCESS_KEY', getEnvVar('AWS_SECRET_ACCESS_KEY', '')),
  endpoint: getEnvVar('EMAIL_S3_ENDPOINT', getEnvVar('AWS_ENDPOINT_URL', '')),
};

/** SMTP inbound server settings */
export const SMTP_INBOUND_CONFIG = {
  port: getEnvNumber('SMTP_PORT', 25),
  securePorts: [465],
  starttlsPort: getEnvNumber('SMTP_STARTTLS_PORT', 587),
  host: getEnvVar('SMTP_HOST', '0.0.0.0'),
  banner: getEnvVar('SMTP_BANNER', `${EMAIL_DOMAIN} ESMTP`),
  maxMessageSize: getEnvNumber('SMTP_MAX_MESSAGE_SIZE', 25 * 1024 * 1024), // 25 MB
  /** TLS certificate paths (for production) */
  tls: {
    key: getEnvVar('SMTP_TLS_KEY', ''),
    cert: getEnvVar('SMTP_TLS_CERT', ''),
  },
};

/** SMTP outbound / sending settings */
export const SMTP_OUTBOUND_CONFIG = {
  /** Optional relay host (empty = direct delivery) */
  relayHost: getEnvVar('SMTP_RELAY_HOST', ''),
  relayPort: getEnvNumber('SMTP_RELAY_PORT', 587),
  relayUser: getEnvVar('SMTP_RELAY_USER', ''),
  relayPass: getEnvVar('SMTP_RELAY_PASS', ''),
  /** Queue retry schedule (in ms) */
  retryDelays: [60_000, 300_000, 900_000, 3600_000, 14400_000],
  /** Max retries before bouncing */
  maxRetries: 5,
};

/** Rspamd HTTP API for spam scoring */
export const SPAM_CONFIG = {
  enabled: getEnvBoolean('SPAM_FILTER_ENABLED', true),
  rspamdUrl: getEnvVar('RSPAMD_URL', 'http://localhost:11333'),
  /** Score threshold above which a message is marked as spam */
  spamThreshold: parseFloat(getEnvVar('SPAM_THRESHOLD', '5.0')),
  /** Score threshold above which a message is rejected outright */
  rejectThreshold: parseFloat(getEnvVar('SPAM_REJECT_THRESHOLD', '15.0')),
};

/** Storage quotas per subscription tier (in bytes) */
export const EMAIL_QUOTAS = {
  free: {
    storage: 5 * 1024 * 1024 * 1024,         // 5 GB
    maxAttachmentSize: 25 * 1024 * 1024,      // 25 MB
    dailySendLimit: 100,
    maxRecipientsPerMessage: 50,
  },
  pro: {
    storage: 50 * 1024 * 1024 * 1024,        // 50 GB
    maxAttachmentSize: 50 * 1024 * 1024,      // 50 MB
    dailySendLimit: 1_000,
    maxRecipientsPerMessage: 100,
  },
  business: {
    storage: 200 * 1024 * 1024 * 1024,       // 200 GB
    maxAttachmentSize: 100 * 1024 * 1024,     // 100 MB
    dailySendLimit: 10_000,
    maxRecipientsPerMessage: 500,
  },
} as const;

export type SubscriptionTier = keyof typeof EMAIL_QUOTAS;

/** Default mailboxes created for every user */
export const DEFAULT_MAILBOXES = [
  { name: 'INBOX', path: 'INBOX', specialUse: '\\Inbox' },
  { name: 'Sent', path: 'Sent', specialUse: '\\Sent' },
  { name: 'Drafts', path: 'Drafts', specialUse: '\\Drafts' },
  { name: 'Trash', path: 'Trash', specialUse: '\\Trash', retentionDays: 30 },
  { name: 'Spam', path: 'Spam', specialUse: '\\Junk', retentionDays: 30 },
  { name: 'Archive', path: 'Archive', specialUse: '\\Archive' },
] as const;

/** Encryption settings */
export const ENCRYPTION_CONFIG = {
  /** Encrypt incoming messages at rest for users with a publicKey */
  encryptAtRest: getEnvBoolean('EMAIL_ENCRYPT_AT_REST', true),
};

/**
 * Resolve the email address for a given username.
 * This is the single source of truth — email is always derived from username.
 */
export function resolveEmailAddress(username: string): string {
  return `${username}@${EMAIL_DOMAIN}`;
}

/**
 * Extract the username from an email address on our domain.
 * Handles plus-aliases: "user+tag@oxy.so" → "user"
 * Returns null if the address is not on our domain.
 */
export function extractUsername(emailAddress: string): string | null {
  const [localPart, domain] = emailAddress.toLowerCase().split('@');
  if (!localPart || domain !== EMAIL_DOMAIN.toLowerCase()) {
    return null;
  }
  // Strip plus-alias
  return localPart.split('+')[0];
}

/**
 * Extract the plus-alias tag from an email address.
 * "user+shopping@oxy.so" → "shopping"
 * Returns null if no alias.
 */
export function extractAliasTag(emailAddress: string): string | null {
  const [localPart] = emailAddress.toLowerCase().split('@');
  const parts = localPart.split('+');
  return parts.length > 1 ? parts.slice(1).join('+') : null;
}
