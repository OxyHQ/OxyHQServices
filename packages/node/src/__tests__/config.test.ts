/**
 * loadConfig tests — env-driven configuration parsing/validation.
 */

import { ConfigError, loadConfig } from '../config';
import { DEFAULT_MAX_BLOB_BYTES, DEFAULT_PORT, PROTOCOL_VERSION } from '../constants';
import { generateTestKeyPair } from './helpers/signEnvelope';

describe('loadConfig', () => {
  const owner = generateTestKeyPair();

  it('throws when the owner public key is absent', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it('throws on a malformed owner public key', () => {
    expect(() => loadConfig({ OXY_NODE_OWNER_PUBLIC_KEY: 'not-a-key' })).toThrow(ConfigError);
  });

  it('applies defaults for the optional fields', () => {
    const config = loadConfig({ OXY_NODE_OWNER_PUBLIC_KEY: owner.publicKey });
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.mode).toBe('self-hosted');
    expect(config.maxBlobBytes).toBe(DEFAULT_MAX_BLOB_BYTES);
    expect(config.ownerPublicKey).toBe(owner.publicKey.toLowerCase());
    expect(config.nodePublicKey).toBe(owner.publicKey.toLowerCase());
    expect(config.nodePrivateKey).toBeNull();
    expect(config.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(config.databasePath.endsWith('node.sqlite')).toBe(true);
  });

  it('parses overrides from the environment', () => {
    const config = loadConfig({
      OXY_NODE_OWNER_PUBLIC_KEY: owner.publicKey,
      OXY_NODE_PORT: '8123',
      OXY_NODE_MODE: 'managed',
      OXY_NODE_MAX_BLOB_BYTES: '1048576',
      OXY_NODE_DB_PATH: '/var/lib/oxy-node/custom.sqlite',
    });
    expect(config.port).toBe(8123);
    expect(config.mode).toBe('managed');
    expect(config.maxBlobBytes).toBe(1048576);
    expect(config.databasePath).toBe('/var/lib/oxy-node/custom.sqlite');
  });

  it('rejects an invalid mode and an out-of-range port', () => {
    expect(() => loadConfig({ OXY_NODE_OWNER_PUBLIC_KEY: owner.publicKey, OXY_NODE_MODE: 'cloud' })).toThrow(ConfigError);
    expect(() => loadConfig({ OXY_NODE_OWNER_PUBLIC_KEY: owner.publicKey, OXY_NODE_PORT: '70000' })).toThrow(ConfigError);
  });
});
