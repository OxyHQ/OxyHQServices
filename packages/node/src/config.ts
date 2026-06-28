/**
 * Env-driven configuration for the Oxy personal data node.
 *
 * All operational knobs come from the environment — nothing is hardcoded. The
 * owner public key is REQUIRED (it is the verification method that authorizes
 * writes); the process refuses to start without a well-formed one.
 *
 * Recognized variables:
 *  - `OXY_NODE_OWNER_PUBLIC_KEY` (required) — the owner's secp256k1 public key
 *    (hex). Only records signed by this key may be written, and it authorizes
 *    blob pins. Compressed (`02|03` + 64 hex) or uncompressed (`04` + 128 hex).
 *  - `OXY_NODE_PUBLIC_KEY` (optional) — the node's own advertised public key
 *    (defaults to the owner key for a self-hosted node).
 *  - `OXY_NODE_PRIVATE_KEY` (optional) — the node's own private key, if the node
 *    needs to sign its own liveness/identity material.
 *  - `OXY_NODE_MODE` (optional) — `self-hosted` (default) or `managed`.
 *  - `OXY_NODE_PORT` (optional) — HTTP port (default {@link DEFAULT_PORT}).
 *  - `OXY_NODE_DATA_DIR` (optional) — directory for the SQLite database
 *    (default `<cwd>/data`).
 *  - `OXY_NODE_DB_PATH` (optional) — explicit SQLite file path (overrides the
 *    data-dir default).
 *  - `OXY_NODE_MAX_BLOB_BYTES` (optional) — max pinned blob size
 *    (default {@link DEFAULT_MAX_BLOB_BYTES}).
 */

import { join, resolve } from 'node:path';
import {
  DEFAULT_MAX_BLOB_BYTES,
  DEFAULT_PORT,
  NODE_MODES,
  PROTOCOL_VERSION,
  type NodeMode,
} from './constants.js';

/** Resolved, validated node configuration. */
export interface NodeConfig {
  /** HTTP port to bind. */
  readonly port: number;
  /** The owner's secp256k1 public key (hex) — the sole write authority. */
  readonly ownerPublicKey: string;
  /** The node's advertised public key (defaults to the owner key). */
  readonly nodePublicKey: string;
  /** The node's own private key, when configured (else null). */
  readonly nodePrivateKey: string | null;
  /** Operating mode advertised in `/.well-known/oxy-node.json`. */
  readonly mode: NodeMode;
  /** Directory holding the SQLite database. */
  readonly dataDir: string;
  /** Absolute path of the SQLite database file. */
  readonly databasePath: string;
  /** Upper bound on a single pinned blob, in bytes. */
  readonly maxBlobBytes: number;
  /** Advertised node-protocol version. */
  readonly protocolVersion: string;
}

/** Thrown when configuration is missing or malformed; the process exits on it. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const COMPRESSED_PUBKEY = /^(02|03)[0-9a-f]{64}$/;
const UNCOMPRESSED_PUBKEY = /^04[0-9a-f]{128}$/;

/** True for a well-formed compressed or uncompressed secp256k1 public key (hex). */
function isValidPublicKey(value: string): boolean {
  const key = value.toLowerCase();
  return COMPRESSED_PUBKEY.test(key) || UNCOMPRESSED_PUBKEY.test(key);
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`OXY_NODE_PORT must be an integer in 1..65535, got "${raw}"`);
  }
  return port;
}

function parseMode(raw: string | undefined): NodeMode {
  if (raw === undefined || raw.trim() === '') {
    return 'self-hosted';
  }
  const mode = raw.trim();
  if ((NODE_MODES as readonly string[]).includes(mode)) {
    return mode as NodeMode;
  }
  throw new ConfigError(`OXY_NODE_MODE must be one of ${NODE_MODES.join(', ')}, got "${raw}"`);
}

function parseMaxBlobBytes(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_MAX_BLOB_BYTES;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`OXY_NODE_MAX_BLOB_BYTES must be a positive integer, got "${raw}"`);
  }
  return value;
}

/**
 * Build a {@link NodeConfig} from the environment.
 *
 * @param env - The environment object (defaults to `process.env`; injectable for tests).
 * @throws {ConfigError} when the owner key is absent/malformed or any value is invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): NodeConfig {
  const ownerRaw = env.OXY_NODE_OWNER_PUBLIC_KEY?.trim();
  if (!ownerRaw) {
    throw new ConfigError('OXY_NODE_OWNER_PUBLIC_KEY is required');
  }
  if (!isValidPublicKey(ownerRaw)) {
    throw new ConfigError('OXY_NODE_OWNER_PUBLIC_KEY must be a hex secp256k1 public key (compressed or uncompressed)');
  }
  const ownerPublicKey = ownerRaw.toLowerCase();

  const nodePublicRaw = env.OXY_NODE_PUBLIC_KEY?.trim();
  if (nodePublicRaw && !isValidPublicKey(nodePublicRaw)) {
    throw new ConfigError('OXY_NODE_PUBLIC_KEY must be a hex secp256k1 public key (compressed or uncompressed)');
  }
  const nodePublicKey = nodePublicRaw ? nodePublicRaw.toLowerCase() : ownerPublicKey;

  const nodePrivateRaw = env.OXY_NODE_PRIVATE_KEY?.trim();
  const nodePrivateKey = nodePrivateRaw ? nodePrivateRaw.toLowerCase() : null;

  const dataDir = resolve(env.OXY_NODE_DATA_DIR?.trim() || join(process.cwd(), 'data'));
  const databasePath = env.OXY_NODE_DB_PATH?.trim()
    ? resolve(env.OXY_NODE_DB_PATH.trim())
    : join(dataDir, 'node.sqlite');

  return {
    port: parsePort(env.OXY_NODE_PORT),
    ownerPublicKey,
    nodePublicKey,
    nodePrivateKey,
    mode: parseMode(env.OXY_NODE_MODE),
    dataDir,
    databasePath,
    maxBlobBytes: parseMaxBlobBytes(env.OXY_NODE_MAX_BLOB_BYTES),
    protocolVersion: PROTOCOL_VERSION,
  };
}
