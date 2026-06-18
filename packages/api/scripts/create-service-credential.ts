#!/usr/bin/env bun
/**
 * Provision a `service`-type ApplicationCredential under an EXISTING active
 * Application, using the EXACT same creation logic as the real
 * credential-create route (`routes/applications.ts` → `generateCredentialMaterial`):
 *   publicKey  = 'oxy_dk_' + 24 random bytes hex   (the apiKey; SAFE to log)
 *   secret     = 32 random bytes hex               (NEVER logged in plaintext)
 *   secretHash = sha256(secret) hex                (the only thing persisted)
 *
 * The plaintext secret only ever lives in a local variable and is fed straight
 * into an AES-256-GCM cipher; ONLY the encrypted form is emitted (so it can be
 * exfiltrated safely via task logs and decrypted out-of-band with the key).
 *
 * Idempotency: if a usable (`isCredentialUsable`) service production credential
 * already exists for the app, it is REUSED — no new credential is minted. The
 * existing secret is NOT recoverable (only its hash is stored), so `secretEnc`
 * is `null` on reuse; rotate the credential if a fresh secret is required.
 *
 * Safety:
 *   - Never creates an Application — it must already exist and be `active`.
 *   - No deletes, no drops, no modification of unrelated documents.
 *   - DRY_RUN=true reports the plan without writing and without emitting a secret.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/scripts/create-service-credential.ts
 *
 * Env:
 *   MONGODB_URI            required (injected by ECS from SSM)
 *   APP_NAME               required, e.g. "Mention"
 *   OWNER_USERNAME         owner username to resolve (default 'oxy')
 *   SCOPES                 required, comma-separated, e.g. "federation:write,user:read"
 *   CREDENTIAL_NAME        credential name (default 'Service')
 *   OUTPUT_ENCRYPTION_KEY  required, 64 hex chars (32 bytes) — AES-256-GCM key
 *   DRY_RUN=true           plan only, no writes, no secret emitted
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import { Application } from '../src/models/Application';
import { ApplicationCredential } from '../src/models/ApplicationCredential';
import { APPLICATION_SCOPES } from '../src/models/Application';
import { isCredentialUsable } from '../src/utils/credentialUsability';
import { User } from '../src/models/User';
import { logger } from '../src/utils/logger';

// ── Mirror routes/applications.ts credential generation EXACTLY ──────────────
const CREDENTIAL_PUBLIC_KEY_PREFIX = 'oxy_dk_';
const PUBLIC_KEY_RANDOM_BYTES = 24;
const SECRET_RANDOM_BYTES = 32;

/** Generate a fresh credential public key + plaintext secret + its hash. */
function generateCredentialMaterial(): { publicKey: string; secret: string; secretHash: string } {
  const publicKey =
    CREDENTIAL_PUBLIC_KEY_PREFIX + crypto.randomBytes(PUBLIC_KEY_RANDOM_BYTES).toString('hex');
  const secret = crypto.randomBytes(SECRET_RANDOM_BYTES).toString('hex');
  const secretHash = crypto.createHash('sha256').update(secret).digest('hex');
  return { publicKey, secret, secretHash };
}

const ENCRYPTION_KEY_HEX_LENGTH = 64; // 32 bytes
const GCM_IV_BYTES = 12;

interface SecretEnvelope {
  ivB64: string;
  ciphertextB64: string;
  tagB64: string;
}

/**
 * AES-256-GCM encrypt the plaintext secret for safe exfiltration via logs. The
 * key (`OUTPUT_ENCRYPTION_KEY`) is held only by the operator; the emitted
 * envelope is useless without it.
 */
function encryptSecret(secret: string, keyHex: string): SecretEnvelope {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ivB64: iv.toString('base64'),
    ciphertextB64: ciphertext.toString('base64'),
    tagB64: tag.toString('base64'),
  };
}

/** Parse + validate the comma-separated SCOPES env against the allowlist. */
function parseAndValidateScopes(raw: string | undefined): string[] {
  const scopes = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (scopes.length === 0) {
    throw new Error(
      'SCOPES is required — provide a comma-separated list, e.g. "federation:write,user:read".',
    );
  }

  const allowed = new Set<string>(APPLICATION_SCOPES);
  const invalid = scopes.filter((s) => !allowed.has(s));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid scope(s): ${invalid.join(', ')}. ` +
        `Allowed scopes: ${APPLICATION_SCOPES.join(', ')}.`,
    );
  }

  // De-duplicate while preserving order.
  return Array.from(new Set(scopes));
}

interface ResultRow {
  app: string;
  applicationId: string;
  ownerUsername: string;
  ownerId: string;
  credentialId: string | null;
  publicKey: string | null;
  type: 'service';
  environment: 'production';
  scopes: string[];
  reused: boolean;
  secretEnc: SecretEnvelope | null;
}

function writeResult(row: ResultRow): void {
  process.stdout.write(`SERVICE_CRED_JSON=${JSON.stringify(row)}\n`);
}

async function run(): Promise<void> {
  const dryRun = process.env.DRY_RUN === 'true';
  const ownerUsername = process.env.OWNER_USERNAME || 'oxy';
  const appName = process.env.APP_NAME;
  const credentialName = process.env.CREDENTIAL_NAME || 'Service';
  const encryptionKeyHex = process.env.OUTPUT_ENCRYPTION_KEY;

  if (dryRun) {
    logger.info('DRY RUN — no writes will be performed, no secret will be emitted');
  }

  if (!appName) {
    throw new Error('APP_NAME is required — e.g. "Mention".');
  }

  // Validate the encryption key up-front (only required when we may emit a secret).
  if (!encryptionKeyHex || !/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) {
    throw new Error(
      'OUTPUT_ENCRYPTION_KEY is required and must be exactly ' +
        `${ENCRYPTION_KEY_HEX_LENGTH} hex characters (32 bytes for AES-256-GCM).`,
    );
  }

  const scopes = parseAndValidateScopes(process.env.SCOPES);
  logger.info('Validated requested scopes', { scopes });

  // ── 1. Resolve owner user ──
  const owner = await User.findOne({ username: ownerUsername }).select('_id username').lean();
  if (!owner?._id) {
    throw new Error(
      `Owner user "${ownerUsername}" not found — refusing to proceed. ` +
        `Set OWNER_USERNAME to the correct platform owner username.`,
    );
  }
  const ownerId = owner._id as mongoose.Types.ObjectId;
  logger.info('Resolved owner user', { username: ownerUsername, ownerId: ownerId.toString() });

  // ── 2. Resolve the EXISTING Application (must already exist + be active) ──
  const application = await Application.findOne({
    name: appName,
    createdByUserId: ownerId,
    status: { $ne: 'deleted' },
  });

  if (!application) {
    throw new Error(`Active Application "${appName}" not found for owner "${ownerUsername}".`);
  }

  if (application.status !== 'active') {
    logger.warn('Application is not active', {
      app: appName,
      applicationId: application._id.toString(),
      status: application.status,
    });
    throw new Error(
      `Application "${appName}" for owner "${ownerUsername}" is not active ` +
        `(status: ${application.status}). Refusing to provision a credential.`,
    );
  }

  const applicationId = application._id;
  logger.info('Resolved active Application', {
    app: appName,
    applicationId: applicationId.toString(),
  });

  // ── 3. Idempotency: reuse an existing usable service production credential ──
  const existing = await ApplicationCredential.findOne({
    applicationId,
    type: 'service',
    environment: 'production',
    status: { $ne: 'revoked' },
  });

  if (existing && isCredentialUsable(existing)) {
    logger.info('Reusing existing usable service credential — NOT minting a new one', {
      applicationId: applicationId.toString(),
      credentialId: existing._id.toString(),
      publicKey: existing.publicKey,
    });
    logger.info(
      'NOTE: the secret of an existing credential is not recoverable (only its hash is stored). ' +
        'Rotate the credential if a fresh secret is required.',
    );

    const reusedResult: ResultRow = {
      app: appName,
      applicationId: applicationId.toString(),
      ownerUsername,
      ownerId: ownerId.toString(),
      credentialId: existing._id.toString(),
      publicKey: existing.publicKey,
      type: 'service',
      environment: 'production',
      scopes: existing.scopes,
      reused: true,
      secretEnc: null,
    };

    writeResult(reusedResult);
    return;
  }

  // ── 4. No usable service credential — plan (dry-run) or mint ──
  if (dryRun) {
    logger.info('DRY RUN — would mint a new service credential', {
      app: appName,
      applicationId: applicationId.toString(),
      credentialName,
      scopes,
    });

    const planResult: ResultRow = {
      app: appName,
      applicationId: applicationId.toString(),
      ownerUsername,
      ownerId: ownerId.toString(),
      credentialId: null,
      publicKey: null,
      type: 'service',
      environment: 'production',
      scopes,
      reused: false,
      secretEnc: null,
    };

    writeResult(planResult);
    return;
  }

  const { publicKey, secret, secretHash } = generateCredentialMaterial();

  const credential = await ApplicationCredential.create({
    applicationId,
    name: credentialName,
    publicKey,
    secretHash,
    type: 'service',
    environment: 'production',
    scopes,
    status: 'active',
    createdByUserId: ownerId,
  });

  logger.info('Service credential created', {
    app: appName,
    applicationId: applicationId.toString(),
    credentialId: credential._id.toString(),
    publicKey: credential.publicKey,
    scopes,
  });

  // Encrypt the plaintext secret — it is NEVER logged in plaintext anywhere.
  const secretEnc = encryptSecret(secret, encryptionKeyHex);

  const result: ResultRow = {
    app: appName,
    applicationId: applicationId.toString(),
    ownerUsername,
    ownerId: ownerId.toString(),
    credentialId: credential._id.toString(),
    publicKey: credential.publicKey,
    type: 'service',
    environment: 'production',
    scopes,
    reused: false,
    secretEnc,
  };

  writeResult(result);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error('MONGODB_URI is required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  logger.info('Connected to MongoDB');

  try {
    await run();
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
}

main().catch((error) => {
  logger.error(
    'Service credential provisioning failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'create-service-credential', method: 'main' },
  );
  process.exit(1);
});
