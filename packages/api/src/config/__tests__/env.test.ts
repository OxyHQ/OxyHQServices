/**
 * Environment configuration validation tests
 *
 * Focus: REFRESH_COOKIE_DOMAIN strict-hostname validation (MED-2). The value
 * is interpolated into a hand-built `Set-Cookie` header
 * (`appendLegacyRefreshCookieDeletion`), so anything beyond a bare hostname
 * (scheme, port, spaces, `;`, `,`, control chars) must fail fast at startup.
 */

import {
  isValidHostname,
  validateRequiredEnvVars,
  ConfigurationError,
  DEV_DEVICE_ID_SALT_DEFAULT,
} from '../env';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const REQUIRED_BASE_ENV: Record<string, string> = {
  MONGODB_URI: 'mongodb://localhost:27017/test',
  ACCESS_TOKEN_SECRET: 'a'.repeat(64),
  REFRESH_TOKEN_SECRET: 'b'.repeat(64),
  FEDCM_TOKEN_SECRET: 'c'.repeat(64),
  AWS_REGION: 'eu-west-1',
  AWS_ACCESS_KEY_ID: 'test-access-key',
  AWS_SECRET_ACCESS_KEY: 'test-secret-key',
  AWS_S3_BUCKET: 'test-bucket',
};

describe('isValidHostname', () => {
  const VALID = [
    'oxy.so',
    'api.oxy.so',
    'localhost',
    'sub-domain.example.com',
    'a.b.c.d.e',
    'xn--bcher-kva.example',
  ];

  const INVALID = [
    'oxy.so; Secure',
    'oxy.so,evil.com',
    'http://oxy.so',
    'oxy .so',
    'oxy.so\nSet-Cookie: x=y',
    'oxy.so\r',
    '.oxy.so',
    'oxy.so.',
    'oxy.so:443',
    'oxy.so/path',
    '-oxy.so',
    'oxy-.so',
    '',
    ' ',
    'oxy_so',
    `${'a'.repeat(64)}.so`,
    `${'a.'.repeat(127)}a${'b'.repeat(10)}`,
  ];

  it.each(VALID)('accepts %j', (value) => {
    expect(isValidHostname(value)).toBe(true);
  });

  it.each(INVALID)('rejects %j', (value) => {
    expect(isValidHostname(value)).toBe(false);
  });
});

describe('validateRequiredEnvVars — REFRESH_COOKIE_DOMAIN', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED_BASE_ENV };
    delete process.env.REFRESH_COOKIE_DOMAIN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('passes when REFRESH_COOKIE_DOMAIN is unset', () => {
    expect(() => validateRequiredEnvVars()).not.toThrow();
  });

  it('passes for a valid bare hostname', () => {
    process.env.REFRESH_COOKIE_DOMAIN = 'oxy.so';
    expect(() => validateRequiredEnvVars()).not.toThrow();

    process.env.REFRESH_COOKIE_DOMAIN = 'api.oxy.so';
    expect(() => validateRequiredEnvVars()).not.toThrow();
  });

  it.each([
    'oxy.so; Secure',
    'oxy.so,evil.com',
    'http://oxy.so',
    'oxy .so',
    'oxy.so\nSet-Cookie: x=y',
  ])('fails fast with a clear error for %j', (value) => {
    process.env.REFRESH_COOKIE_DOMAIN = value;
    expect(() => validateRequiredEnvVars()).toThrow(ConfigurationError);
    expect(() => validateRequiredEnvVars()).toThrow(/REFRESH_COOKIE_DOMAIN/);
  });
});

describe('validateRequiredEnvVars — DEVICE_ID_SALT (security review H1)', () => {
  const originalEnv = process.env;
  const STRONG_SALT = 'x'.repeat(48);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, ...REQUIRED_BASE_ENV };
    delete process.env.REFRESH_COOKIE_DOMAIN;
    delete process.env.DEVICE_ID_SALT;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('in production', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('fails fast when DEVICE_ID_SALT is unset', () => {
      expect(() => validateRequiredEnvVars()).toThrow(ConfigurationError);
      expect(() => validateRequiredEnvVars()).toThrow(/DEVICE_ID_SALT/);
    });

    it('fails fast when DEVICE_ID_SALT is too short', () => {
      process.env.DEVICE_ID_SALT = 'too-short';
      expect(() => validateRequiredEnvVars()).toThrow(ConfigurationError);
      expect(() => validateRequiredEnvVars()).toThrow(/DEVICE_ID_SALT/);
      expect(() => validateRequiredEnvVars()).toThrow(/at least 32/);
    });

    it('passes for a strong salt and does NOT log a placeholder warning', () => {
      process.env.DEVICE_ID_SALT = STRONG_SALT;
      expect(() => validateRequiredEnvVars()).not.toThrow();
      const warnCalls = (logger.warn as jest.Mock).mock.calls.flat().join(' ');
      expect(warnCalls).not.toMatch(/development-only placeholder/);
    });

    it('NEVER installs the dev placeholder in production', () => {
      expect(() => validateRequiredEnvVars()).toThrow();
      expect(process.env.DEVICE_ID_SALT).toBeUndefined();
    });
  });

  describe('in development', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('installs the documented dev placeholder when DEVICE_ID_SALT is unset', () => {
      expect(() => validateRequiredEnvVars()).not.toThrow();
      expect(process.env.DEVICE_ID_SALT).toBe(DEV_DEVICE_ID_SALT_DEFAULT);
    });

    it('logs an explicit WARN when falling back to the dev placeholder', () => {
      validateRequiredEnvVars();
      const warnCalls = (logger.warn as jest.Mock).mock.calls;
      const matched = warnCalls.some(([msg]) =>
        typeof msg === 'string' && /development-only placeholder/.test(msg)
      );
      expect(matched).toBe(true);
    });

    it('does NOT overwrite an operator-provided dev salt', () => {
      process.env.DEVICE_ID_SALT = STRONG_SALT;
      validateRequiredEnvVars();
      expect(process.env.DEVICE_ID_SALT).toBe(STRONG_SALT);
    });

    it('still rejects a too-short salt in development', () => {
      process.env.DEVICE_ID_SALT = 'too-short';
      expect(() => validateRequiredEnvVars()).toThrow(ConfigurationError);
      expect(() => validateRequiredEnvVars()).toThrow(/DEVICE_ID_SALT/);
    });
  });
});
