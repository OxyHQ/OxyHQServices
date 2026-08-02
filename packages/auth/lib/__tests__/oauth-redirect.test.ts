import { describe, expect, test } from 'bun:test';
import { safeRedirectUrl } from '@/lib/oauth-redirect';

describe('safeRedirectUrl', () => {
  test('accepts https origins without trailing slash noise', () => {
    expect(safeRedirectUrl('https://accounts.oxy.so/')).toBe('https://accounts.oxy.so');
    expect(safeRedirectUrl('https://accounts.oxy.so')).toBe('https://accounts.oxy.so');
  });

  test('preserves path and query on https redirects', () => {
    expect(safeRedirectUrl('https://inbox.oxy.so/callback?x=1')).toBe(
      'https://inbox.oxy.so/callback?x=1',
    );
  });

  test('rejects raw IP hosts', () => {
    expect(safeRedirectUrl('https://127.0.0.1/callback')).toBeNull();
  });

  test('rejects unknown schemes', () => {
    expect(safeRedirectUrl('javascript:alert(1)')).toBeNull();
  });

  test('allows registered native schemes', () => {
    expect(safeRedirectUrl('astro://oauth/callback')).toBe('astro://oauth/callback');
  });
});
