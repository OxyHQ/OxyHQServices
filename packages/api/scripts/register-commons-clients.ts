#!/usr/bin/env bun
/**
 * Idempotent admin script: register the two production `Application` client ids
 * required by the "Sign in with Oxy" feature —
 *
 *   1. Commons by Oxy  — the native self-sovereign identity wallet whose
 *      `OxyProvider clientId` (`EXPO_PUBLIC_OXY_CLIENT_ID` in
 *      `packages/commons/constants/oxy.ts`) must be a real registered public
 *      `ApplicationCredential`.
 *   2. Oxy Auth        — the third-party OAuth IdP app, which ALSO acts as its
 *      own Relying Party for the Sign-in-with-Oxy QR handoff and therefore
 *      needs a public client id + its own redirect origins.
 *
 * Both Applications live in the production "Oxy" team workspace, owned by the
 * platform user `oxy`. For each app this UPSERTS (never duplicates on re-run):
 *   - Application       keyed by (name + createdByUserId = oxyId)
 *   - a single owner AccountMember for oxy on the Oxy org account (app access
 *     derives from it — no per-app member row)
 *   - ApplicationCredential  type:'public', environment:'production',
 *                            publicKey minted EXACTLY like the real create route
 *                            (`oxy_dk_` + 24 random bytes hex). A `public`
 *                            credential carries NO secret. Existing active public
 *                            production credentials are REUSED — never re-minted.
 *
 * The "Oxy Auth" app is the SAME record seeded by
 * `scripts/seed-oxy-applications.ts` (idempotency key is name + owner). This
 * script reuses that record and its credential; the only delta is that it UNIONS
 * the auth-RP redirect origins into `redirectUris` (the seed currently sets them
 * to `[]` because historically the IdP did not consume its own callback — see
 * the report note about keeping the seed in sync).
 *
 * Safety:
 *   - No deletes, no drops. Existing redirectUris/scopes are UNIONed, never
 *     stripped. No modification of unrelated documents.
 *   - Re-running performs 0 inserts/updates once registered.
 *   - DRY_RUN=1 (or DRY_RUN=true) reports the plan without writing.
 *   - Verifies the known production workspace + owner ids exist before writing;
 *     aborts with a clear error if either is missing or mismatched (guards
 *     against pointing at the wrong database/environment).
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/scripts/register-commons-clients.ts
 * Or via the npm script (from packages/api):
 *   bun run register:commons-clients
 *
 * Env:
 *   MONGODB_URI   required (injected by ECS from SSM)
 *   DRY_RUN=1     plan only, no writes
 *
 * Output (non-secret client ids — safe to log and parse from ECS task logs):
 *   COMMONS_CLIENT_ID=<oxy_dk_...>
 *   AUTH_IDP_CLIENT_ID=<oxy_dk_...>
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import { Application, type IApplication } from '../src/models/Application';
import { ApplicationCredential } from '../src/models/ApplicationCredential';
import AccountMember from '../src/models/AccountMember';
import { User } from '../src/models/User';
import { permissionsForAccountRole } from '../src/utils/accountRoles';
import { logger } from '../src/utils/logger';
import type { ApplicationScope } from '../src/utils/applicationScopes';

// ── Mirror routes/applications.ts credential generation EXACTLY ──────────────
const CREDENTIAL_PUBLIC_KEY_PREFIX = 'oxy_dk_';
const PUBLIC_KEY_RANDOM_BYTES = 24;

function generatePublicKey(): string {
  return CREDENTIAL_PUBLIC_KEY_PREFIX + crypto.randomBytes(PUBLIC_KEY_RANDOM_BYTES).toString('hex');
}

// ── Known production identifiers (the Oxy team workspace + platform owner) ───
// These are verified to exist before any write so the script fails loudly if it
// is ever pointed at the wrong database/environment.
const OXY_OWNER_USER_ID = '69b2d3df5d12f58c9800d651';
const OXY_OWNER_USERNAME = 'oxy';

const SSO_CALLBACK_PATH = '/__oxy/sso-callback';
const cb = (origin: string): string => `${origin}${SSO_CALLBACK_PATH}`;

type ClientKey = 'COMMONS_CLIENT_ID' | 'AUTH_IDP_CLIENT_ID';

interface ClientSpec {
  /** Output env key printed at the end. */
  key: ClientKey;
  /** Idempotency key (with createdByUserId = oxyId). DO NOT rename casually. */
  name: string;
  description: string;
  websiteUrl?: string;
  type: IApplication['type'];
  redirectUris: string[];
  scopes: ApplicationScope[];
}

const CLIENTS: ClientSpec[] = [
  {
    key: 'COMMONS_CLIENT_ID',
    name: 'Commons by Oxy',
    description:
      'Official Oxy Commons app — self-sovereign identity wallet and Sign-in-with-Oxy approvals (native).',
    type: 'first_party',
    // Commons is a native-only app (no web). Its public client id (this
    // credential's publicKey) is what wires into OxyProvider; the redirect
    // surface is the app's two deep-link schemes from packages/commons/app.json.
    redirectUris: ['commons://', 'oxycommons://'],
    scopes: ['user:read'],
  },
  {
    key: 'AUTH_IDP_CLIENT_ID',
    name: 'Oxy Auth',
    description:
      'Official Oxy authentication app and third-party OAuth Identity Provider, acting as its own Relying Party for Sign in with Oxy.',
    websiteUrl: 'https://auth.oxy.so',
    type: 'first_party',
    // The IdP now consumes Sign-in-with-Oxy as an RP, so it needs its own origin
    // + callback registered. UNIONed into any existing redirectUris.
    // NOTE (found during the wave-2 comment sweep, NOT fixed here — logic, not
    // a comment): `cb()` below builds `${origin}${SSO_CALLBACK_PATH}`, i.e.
    // `https://auth.oxy.so/__oxy/sso-callback` — the deleted SSO-bounce
    // callback path. If Oxy Auth's own RP flow no longer consumes that path,
    // this redirectUri may be seeding a dead route; needs an engineer decision
    // + a live check of what path the QR/Commons RP flow actually redeems.
    redirectUris: ['https://auth.oxy.so', cb('https://auth.oxy.so')],
    scopes: ['user:read'],
  },
];

interface MappingRow {
  key: ClientKey;
  app: string;
  type: IApplication['type'];
  applicationId: string;
  clientId: string;
  redirectUris: string[];
  createdApplication: boolean;
  updatedApplication: boolean;
  createdCredential: boolean;
  reusedCredential: boolean;
}

/**
 * Resolve and validate the production Oxy owner, and resolve (minting if
 * absent) the Oxy `kind:'organization'` account that owns the official apps.
 * Aborts (throws) if the owner is missing/inconsistent, so the script never
 * writes into the wrong database.
 */
async function resolveTargets(dryRun: boolean): Promise<{
  oxyId: mongoose.Types.ObjectId;
  ownerAccountId: mongoose.Types.ObjectId;
}> {
  const owner = await User.findById(OXY_OWNER_USER_ID).select('_id username').lean();
  if (!owner?._id) {
    throw new Error(
      `Owner user _id ${OXY_OWNER_USER_ID} (username "${OXY_OWNER_USERNAME}") not found — ` +
        'refusing to register clients. Wrong database/environment?'
    );
  }
  if (owner.username !== OXY_OWNER_USERNAME) {
    throw new Error(
      `Owner user _id ${OXY_OWNER_USER_ID} resolved to username "${owner.username}", ` +
        `expected "${OXY_OWNER_USERNAME}" — refusing to register clients.`
    );
  }
  const oxyId = owner._id as mongoose.Types.ObjectId;
  const oxyAccountName = process.env.OXY_ACCOUNT_NAME || 'Oxy';

  // Resolve (or mint) the Oxy organization account that owns the official apps,
  // parented under the `oxy` user. Idempotent: keyed by (parentAccountId, kind,
  // name.first). This is the same account the data migration (Phase 2) mints.
  let oxyOrg = await User.findOne({
    parentAccountId: oxyId,
    kind: 'organization',
    'name.first': oxyAccountName,
  });
  if (!oxyOrg && !dryRun) {
    const baseUsername = `${OXY_OWNER_USERNAME}-org`;
    let username = baseUsername;
    for (let suffix = 1; suffix <= 1000; suffix += 1) {
      const taken = await User.findOne({ username }).select('_id').lean();
      if (!taken) break;
      username = `${baseUsername}${suffix}`;
    }
    oxyOrg = await User.create({
      username,
      name: { first: oxyAccountName },
      kind: 'organization',
      type: 'local',
      verified: true,
      authMethods: [],
      parentAccountId: oxyId,
      ancestors: [oxyId],
      rootAccountId: oxyId,
      accountStatus: 'active',
    });
  }
  const ownerAccountId = oxyOrg?._id ?? new mongoose.Types.ObjectId('000000000000000000000000');

  // Owner AccountMember for oxy on the org (idempotent).
  if (oxyOrg && !dryRun) {
    const existingOwner = await AccountMember.findOne({
      accountId: oxyOrg._id,
      memberUserId: oxyId,
    });
    if (!existingOwner) {
      await AccountMember.create({
        accountId: oxyOrg._id,
        memberUserId: oxyId,
        role: 'owner',
        permissions: permissionsForAccountRole('owner'),
        inherit: true,
        status: 'active',
        joinedAt: new Date(),
      });
    }
  }

  logger.info('Resolved production targets', {
    oxyId: oxyId.toString(),
    ownerUsername: OXY_OWNER_USERNAME,
    ownerAccountId: ownerAccountId.toString(),
  });

  return { oxyId, ownerAccountId };
}

async function register(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  if (dryRun) {
    logger.info('DRY RUN — no writes will be performed');
  }

  const { oxyId, ownerAccountId } = await resolveTargets(dryRun);
  const mapping: MappingRow[] = [];

  for (const spec of CLIENTS) {
    let createdApplication = false;
    let updatedApplication = false;
    let createdCredential = false;
    let reusedCredential = false;

    // ── Application: upsert keyed by (name, createdByUserId) ──
    let application = await Application.findOne({ name: spec.name, createdByUserId: oxyId });

    if (!application) {
      createdApplication = true;
      if (!dryRun) {
        application = await Application.create({
          name: spec.name,
          description: spec.description,
          websiteUrl: spec.websiteUrl,
          type: spec.type,
          status: 'active',
          isOfficial: true,
          isInternal: spec.type === 'internal',
          capabilities: [],
          redirectUris: spec.redirectUris,
          scopes: spec.scopes,
          ownerAccountId,
          createdByUserId: oxyId,
        });
      }
    } else if (!dryRun) {
      // Reconcile non-destructively: ensure trusted-official flags + status, and
      // UNION the required redirect origins / scopes (never strip existing ones).
      if (application.status !== 'active') application.status = 'active';
      if (!application.isOfficial) application.isOfficial = true;
      if (application.type !== spec.type) application.type = spec.type;
      if (application.isInternal !== (spec.type === 'internal')) {
        application.isInternal = spec.type === 'internal';
      }
      if (!application.ownerAccountId || !application.ownerAccountId.equals(ownerAccountId)) {
        application.ownerAccountId = ownerAccountId;
      }

      const mergedRedirects = Array.from(
        new Set([...(application.redirectUris ?? []), ...spec.redirectUris])
      );
      if (mergedRedirects.length !== (application.redirectUris ?? []).length) {
        application.redirectUris = mergedRedirects;
      }

      const mergedScopes = Array.from(
        new Set<ApplicationScope>([...(application.scopes ?? []), ...spec.scopes])
      );
      if (mergedScopes.length !== (application.scopes ?? []).length) {
        application.scopes = mergedScopes;
      }

      if (application.isModified()) {
        await application.save();
        updatedApplication = true;
      }
    }

    // In dry-run with a not-yet-existing app, synthesize a placeholder id.
    const applicationId =
      application?._id ?? new mongoose.Types.ObjectId('000000000000000000000000');

    // Ownership/membership is handled ONCE at the org-account level in
    // resolveTargets — app access for `oxy` derives from the Oxy org
    // AccountMember (no per-app member row).

    // ── ApplicationCredential: reuse an existing active public prod cred ──
    let credential = await ApplicationCredential.findOne({
      applicationId,
      type: 'public',
      environment: 'production',
      status: 'active',
    });

    if (credential) {
      reusedCredential = true;
    } else {
      createdCredential = true;
      if (!dryRun && application) {
        credential = await ApplicationCredential.create({
          applicationId,
          name: 'Production',
          publicKey: generatePublicKey(),
          // public client → NO secret / secretHash (mirrors routes/applications.ts)
          type: 'public',
          environment: 'production',
          scopes: spec.scopes,
          status: 'active',
          createdByUserId: oxyId,
        });
      }
    }

    const clientId =
      credential?.publicKey ?? (dryRun ? '(dry-run-would-mint)' : 'ERROR-no-credential');

    mapping.push({
      key: spec.key,
      app: spec.name,
      type: spec.type,
      applicationId: applicationId.toString(),
      clientId,
      redirectUris: application?.redirectUris ?? spec.redirectUris,
      createdApplication,
      updatedApplication,
      createdCredential,
      reusedCredential,
    });
  }

  logger.info('Registration summary', {
    dryRun,
    clients: CLIENTS.length,
    appsCreated: mapping.filter((m) => m.createdApplication).length,
    appsUpdated: mapping.filter((m) => m.updatedApplication).length,
    credentialsCreated: mapping.filter((m) => m.createdCredential).length,
    credentialsReused: mapping.filter((m) => m.reusedCredential).length,
  });

  // ── Emit the two non-secret client ids in a stable, parseable format ──
  const byKey = (key: ClientKey): string =>
    mapping.find((m) => m.key === key)?.clientId ?? 'ERROR-missing';

  /* eslint-disable no-console */
  console.log(`COMMONS_CLIENT_ID=${byKey('COMMONS_CLIENT_ID')}`);
  console.log(`AUTH_IDP_CLIENT_ID=${byKey('AUTH_IDP_CLIENT_ID')}`);
  console.log('OXY_SIGNIN_CLIENTS_JSON=' + JSON.stringify(mapping));
  /* eslint-enable no-console */
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
    await register();
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
}

main().catch((error) => {
  logger.error('Client registration failed', error instanceof Error ? error : new Error(String(error)), {
    component: 'register-commons-clients',
    method: 'main',
  });
  process.exit(1);
});
