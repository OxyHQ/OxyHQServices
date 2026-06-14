import { resolveAppDisplayName } from '../appName';

// The shared react-native mock pins `Platform.OS` to 'web', which is exactly
// the platform on which the historical "web wants to access your Oxy account"
// regression occurred. These tests assert the resolution order that prevents it.

describe('resolveAppDisplayName', () => {
  const originalTitle = typeof document !== 'undefined' ? document.title : '';

  afterEach(() => {
    if (typeof document !== 'undefined') {
      document.title = originalTitle;
    }
  });

  it('prefers an explicit appName, trimmed', () => {
    expect(resolveAppDisplayName('  Mention  ', 'oxy_session')).toBe('Mention');
  });

  it('explicit appName wins over a custom storageKeyPrefix', () => {
    expect(resolveAppDisplayName('Mention', 'homiio')).toBe('Mention');
  });

  it('capitalizes a custom storageKeyPrefix when no appName is given', () => {
    expect(resolveAppDisplayName(undefined, 'mention')).toBe('Mention');
  });

  it('ignores the default storageKeyPrefix (never surfaces "Oxy_session")', () => {
    if (typeof document !== 'undefined') {
      document.title = '';
    }
    expect(resolveAppDisplayName(undefined, 'oxy_session')).toBe('web');
  });

  it('falls back to document.title on web when no name or custom prefix is set', () => {
    if (typeof document !== 'undefined') {
      document.title = 'Homiio';
    }
    expect(resolveAppDisplayName(undefined, 'oxy_session')).toBe('Homiio');
  });

  it('falls back to the platform only when nothing else is available', () => {
    if (typeof document !== 'undefined') {
      document.title = '';
    }
    expect(resolveAppDisplayName(undefined, undefined)).toBe('web');
  });

  it('treats a whitespace-only appName as absent', () => {
    expect(resolveAppDisplayName('   ', 'mention')).toBe('Mention');
  });
});
