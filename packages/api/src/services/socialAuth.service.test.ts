jest.mock('jsonwebtoken', () => jest.requireActual('jsonwebtoken'));

import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import socialAuthService from './socialAuth.service';

describe('SocialAuthService.verifyAppleToken', () => {
  const originalAppleClientId = process.env.APPLE_CLIENT_ID;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.APPLE_CLIENT_ID = 'com.oxy.test';
    jest.restoreAllMocks();
  });

  afterEach(() => {
    if (originalAppleClientId === undefined) {
      delete process.env.APPLE_CLIENT_ID;
    } else {
      process.env.APPLE_CLIENT_ID = originalAppleClientId;
    }
    global.fetch = originalFetch;
  });

  it('rejects an unsigned forged Apple token', async () => {
    const forgedToken = jwt.sign(
      {
        iss: 'https://appleid.apple.com',
        aud: 'com.oxy.test',
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: 'attacker-controlled-sub',
        email: 'victim@example.com',
      },
      '',
      { algorithm: 'none' },
    );

    await expect(socialAuthService.verifyAppleToken(forgedToken)).resolves.toBeNull();
  });

  it('fails closed when APPLE_CLIENT_ID is unset', async () => {
    delete process.env.APPLE_CLIENT_ID;
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const idToken = jwt.sign(
      { iss: 'https://appleid.apple.com', aud: 'com.oxy.test', sub: 'apple-user-123' },
      privateKey,
      { algorithm: 'RS256', keyid: 'apple-key-1', expiresIn: '1h' },
    );

    await expect(socialAuthService.verifyAppleToken(idToken)).resolves.toBeNull();
  });

  it('accepts an Apple token only after verifying its RS256 signature and claims', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            keys: [{ ...jwk, kid: 'apple-key-1', kty: 'RSA', use: 'sig', alg: 'RS256' }],
          }),
      } as Response),
    );

    const idToken = jwt.sign(
      {
        iss: 'https://appleid.apple.com',
        aud: 'com.oxy.test',
        sub: 'apple-user-123',
        email: 'user@example.com',
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'apple-key-1',
        expiresIn: '1h',
      },
    );

    await expect(socialAuthService.verifyAppleToken(idToken)).resolves.toEqual({
      email: 'user@example.com',
      providerId: 'apple-user-123',
    });
  });
});
