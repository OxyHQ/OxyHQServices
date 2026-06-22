#!/usr/bin/env bun
/**
 * Idempotent seed: register a first-party / internal `Application` record for
 * every official Oxy app in the ecosystem, owned by the platform user `oxy`.
 *
 * For each app this UPSERTS (never duplicates on re-run):
 *   - Application      keyed by (name + createdByUserId = oxyId)
 *   - ApplicationMember owner membership for oxy, keyed by (applicationId,userId)
 *   - ApplicationCredential  type:'public', environment:'production',
 *                            publicKey minted EXACTLY like the real create route
 *                            (`oxy_dk_` + 24 random bytes hex). A `public`
 *                            credential carries NO secret (secretHash absent),
 *                            mirroring `routes/applications.ts`. Existing public
 *                            prod credentials are REUSED — never re-minted.
 *
 * Safety:
 *   - No deletes, no drops, no modification of unrelated documents.
 *   - Re-running performs 0 inserts once seeded (verified by the summary).
 *   - DRY_RUN=true reports the plan without writing.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/scripts/seed-oxy-applications.ts
 *
 * Env:
 *   MONGODB_URI   required (injected by ECS from SSM)
 *   OXY_USERNAME  owner username to resolve (default 'oxy')
 *   DRY_RUN=true  plan only, no writes
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import { Application } from '../src/models/Application';
import { ApplicationCredential } from '../src/models/ApplicationCredential';
import { ApplicationMember } from '../src/models/ApplicationMember';
import { Workspace } from '../src/models/Workspace';
import { WorkspaceMember } from '../src/models/WorkspaceMember';
import { User } from '../src/models/User';
import { permissionsForRole } from '../src/utils/applicationRoles';
import { permissionsForRole as workspacePermissionsForRole } from '../src/utils/workspaceRoles';
import { generateUniqueWorkspaceSlug } from '../src/utils/workspaceProvisioning';
import { logger } from '../src/utils/logger';
import type { ApplicationScope } from '../src/utils/applicationScopes';

// ── Mirror routes/applications.ts credential generation EXACTLY ──────────────
const CREDENTIAL_PUBLIC_KEY_PREFIX = 'oxy_dk_';
const PUBLIC_KEY_RANDOM_BYTES = 24;

function generatePublicKey(): string {
  return CREDENTIAL_PUBLIC_KEY_PREFIX + crypto.randomBytes(PUBLIC_KEY_RANDOM_BYTES).toString('hex');
}

type AppType = 'first_party' | 'internal';

interface SeedAppSpec {
  name: string;
  description: string;
  websiteUrl?: string;
  type: AppType;
  redirectUris: string[];
  /**
   * App-level scopes. Defaults to `['user:read']`. A PRIVILEGED scope (e.g.
   * `federation:write`) is staff-only and is never self-grantable via the API —
   * granting it here (in this canonical seed, run by staff) is the supported way
   * to elevate an official app. The service-token mint intersects a credential's
   * scopes with the app's scopes, so a credential's `federation:write` only
   * survives if the app ALSO carries it. Mention's federation feature therefore
   * requires `federation:write` here.
   */
  scopes?: ApplicationScope[];
}

const SSO_CALLBACK_PATH = '/__oxy/sso-callback';
const cb = (origin: string): string => `${origin}${SSO_CALLBACK_PATH}`;

/**
 * The official Oxy ecosystem apps that integrate Oxy auth.
 * `name` is the idempotency key (with createdByUserId=oxyId) — DO NOT rename
 * casually, a rename creates a new Application rather than updating one.
 */
const SEED_APPS: SeedAppSpec[] = [
  // ── OxyHQServices first-party web apps (CF Pages) ──
  {
    name: 'Oxy Accounts',
    description: 'Official Oxy account management app (My Account).',
    websiteUrl: 'https://accounts.oxy.so',
    type: 'first_party',
    redirectUris: [cb('https://accounts.oxy.so')],
  },
  {
    name: 'Oxy Console',
    description: 'Official Oxy developer console (Cloud).',
    websiteUrl: 'https://console.oxy.so',
    type: 'first_party',
    redirectUris: [cb('https://console.oxy.so')],
  },
  {
    name: 'Oxy Inbox',
    description: 'Official Oxy email/inbox app.',
    websiteUrl: 'https://inbox.oxy.so',
    type: 'first_party',
    redirectUris: [cb('https://inbox.oxy.so')],
  },
  {
    name: 'Oxy Auth',
    description: 'Official Oxy authentication app and FedCM Identity Provider.',
    websiteUrl: 'https://auth.oxy.so',
    type: 'first_party',
    // The auth app IS the IdP; it does not consume its own /__oxy/sso-callback.
    redirectUris: [],
  },
  // ── Ecosystem first-party apps ──
  {
    name: 'Mention',
    description: 'Official Oxy social media app with fediverse support.',
    websiteUrl: 'https://mention.earth',
    type: 'first_party',
    redirectUris: [cb('https://mention.earth')],
    // Mention federates: its service credential signs HTTP-Signatures and
    // resolves federated users. The mint intersects credential scopes with these
    // app scopes, so the app MUST carry federation:write for the credential's
    // federation:write to survive. files:write is needed for federated-media S3
    // caching (POST /assets/service/cache).
    scopes: ['user:read', 'files:write', 'federation:write'],
  },
  {
    name: 'Homiio',
    description: 'Official Oxy real estate platform.',
    websiteUrl: 'https://homiio.com',
    type: 'first_party',
    redirectUris: [cb('https://homiio.com')],
  },
  {
    name: 'Allo',
    description: 'Official Oxy encrypted messaging app.',
    websiteUrl: 'https://allo.you',
    type: 'first_party',
    redirectUris: [cb('https://allo.you'), cb('https://allo.oxy.so')],
  },
  {
    name: 'Alia',
    description: 'Official Oxy AI platform (chat app, console, canvas, gateway).',
    websiteUrl: 'https://alia.onl',
    type: 'first_party',
    redirectUris: [cb('https://alia.onl')],
  },
  {
    name: 'Syra',
    description: 'Official Oxy app.',
    websiteUrl: 'https://syra.oxy.so',
    type: 'first_party',
    redirectUris: [cb('https://syra.oxy.so')],
  },
  {
    name: 'TNP',
    description: 'Official Oxy alternative DNS/namespace system.',
    websiteUrl: 'https://tnp.network',
    type: 'first_party',
    redirectUris: [cb('https://tnp.network')],
  },
  {
    name: 'Oxy Website',
    description: 'Official Oxy / FairCoin marketing website.',
    websiteUrl: 'https://oxy.so',
    type: 'first_party',
    redirectUris: [cb('https://oxy.so'), cb('https://fairco.in')],
  },
  {
    name: 'Oxy Pay',
    description: 'Official Oxy payments app.',
    websiteUrl: 'https://pay.oxy.so',
    type: 'first_party',
    redirectUris: [cb('https://pay.oxy.so')],
  },
  {
    name: 'Noted',
    description: 'Official Oxy notes app.',
    websiteUrl: 'https://noted.oxy.so',
    type: 'first_party',
    redirectUris: [cb('https://noted.oxy.so')],
  },
  {
    name: 'Mercaria',
    description: 'Official Oxy marketplace app — buy and sell new and secondhand items.',
    websiteUrl: 'https://mercaria.co',
    type: 'first_party',
    redirectUris: [cb('https://mercaria.co')],
  },
  {
    name: 'Moovo',
    description: 'Official Oxy courier/transport app — send packages, food, and moves.',
    websiteUrl: 'https://moovo.now',
    type: 'first_party',
    redirectUris: [
      cb('https://moovo.now'),
      'https://moovo.now',
      cb('https://go.moovo.now'),
      'https://go.moovo.now',
      cb('https://hub.moovo.now'),
      'https://hub.moovo.now',
    ],
  },
];

interface MappingRow {
  app: string;
  type: AppType;
  applicationId: string;
  clientId: string;
  redirectUris: string[];
  websiteUrl?: string;
  createdApplication: boolean;
  createdMember: boolean;
  createdCredential: boolean;
}

async function seed(): Promise<void> {
  const dryRun = process.env.DRY_RUN === 'true';
  const ownerUsername = process.env.OXY_USERNAME || 'oxy';

  if (dryRun) {
    logger.info('DRY RUN — no writes will be performed');
  }

  const owner = await User.findOne({ username: ownerUsername }).select('_id username').lean();
  if (!owner?._id) {
    throw new Error(
      `Owner user "${ownerUsername}" not found — refusing to seed. ` +
        `Set OXY_USERNAME to the correct platform owner username.`,
    );
  }
  const oxyId = owner._id as mongoose.Types.ObjectId;
  logger.info('Resolved owner user', { username: ownerUsername, oxyId: oxyId.toString() });

  // ── Oxy team Workspace: every seeded official app belongs to it ──
  // Idempotent, keyed by (name='Oxy', ownerId=oxyId, type='team'). Mirrors the
  // special case in scripts/migrate-workspaces.ts.
  const oxyWorkspaceName = process.env.OXY_WORKSPACE_NAME || 'Oxy';
  let oxyWorkspace = await Workspace.findOne({
    name: oxyWorkspaceName,
    ownerId: oxyId,
    type: 'team',
    status: 'active',
  });
  if (!oxyWorkspace && !dryRun) {
    const slug = await generateUniqueWorkspaceSlug(oxyWorkspaceName);
    oxyWorkspace = await Workspace.create({
      name: oxyWorkspaceName,
      slug,
      type: 'team',
      ownerId: oxyId,
      status: 'active',
    });
  }
  const oxyWorkspaceId =
    oxyWorkspace?._id ?? new mongoose.Types.ObjectId('000000000000000000000000');
  if (oxyWorkspace && !dryRun) {
    const wsMember = await WorkspaceMember.findOne({
      workspaceId: oxyWorkspace._id,
      userId: oxyId,
    });
    if (!wsMember) {
      await WorkspaceMember.create({
        workspaceId: oxyWorkspace._id,
        userId: oxyId,
        role: 'owner',
        permissions: workspacePermissionsForRole('owner'),
        status: 'active',
        joinedAt: new Date(),
      });
    }
  }
  logger.info('Oxy team workspace', {
    name: oxyWorkspaceName,
    workspaceId: oxyWorkspaceId.toString(),
    created: !!oxyWorkspace && oxyWorkspace.isNew,
  });

  const ownerPermissions = permissionsForRole('owner');
  const mapping: MappingRow[] = [];

  let appsCreated = 0;
  let appsUpdated = 0;
  let membersCreated = 0;
  let credentialsCreated = 0;
  let credentialsReused = 0;

  for (const spec of SEED_APPS) {
    let createdApplication = false;
    let createdMember = false;
    let createdCredential = false;

    // ── Application: upsert keyed by (name, createdByUserId) ──
    let application = await Application.findOne({ name: spec.name, createdByUserId: oxyId });

    const desiredAppFields = {
      description: spec.description,
      websiteUrl: spec.websiteUrl,
      type: spec.type,
      status: 'active' as const,
      isOfficial: true,
      isInternal: spec.type === 'internal',
      capabilities: [] as string[],
      redirectUris: spec.redirectUris,
      scopes: spec.scopes ?? (['user:read'] as ApplicationScope[]),
      workspaceId: oxyWorkspaceId,
    };

    if (!application) {
      createdApplication = true;
      if (!dryRun) {
        application = await Application.create({
          name: spec.name,
          createdByUserId: oxyId,
          ...desiredAppFields,
        });
      }
      appsCreated += 1;
    } else if (!dryRun) {
      // Reconcile fields so the canonical record matches the spec without ever
      // touching unrelated documents. Safe & idempotent (no-op after first sync).
      application.description = desiredAppFields.description;
      application.websiteUrl = desiredAppFields.websiteUrl;
      application.type = desiredAppFields.type;
      application.status = desiredAppFields.status;
      application.isOfficial = desiredAppFields.isOfficial;
      application.isInternal = desiredAppFields.isInternal;
      application.capabilities = desiredAppFields.capabilities;
      application.redirectUris = desiredAppFields.redirectUris;
      application.scopes = desiredAppFields.scopes;
      application.workspaceId = desiredAppFields.workspaceId;
      if (application.isModified()) {
        await application.save();
        appsUpdated += 1;
      }
    }

    // In dry-run with a not-yet-existing app, synthesize a placeholder id.
    const applicationId =
      application?._id ?? new mongoose.Types.ObjectId('000000000000000000000000');

    // ── ApplicationMember: owner membership for oxy ──
    const existingMember = await ApplicationMember.findOne({
      applicationId,
      userId: oxyId,
    });
    if (!existingMember) {
      createdMember = true;
      if (!dryRun && application) {
        await ApplicationMember.create({
          applicationId,
          userId: oxyId,
          role: 'owner',
          permissions: ownerPermissions,
          status: 'active',
          joinedAt: new Date(),
        });
        membersCreated += 1;
      }
    }

    // ── ApplicationCredential: reuse an existing active public prod cred ──
    let credential = await ApplicationCredential.findOne({
      applicationId,
      type: 'public',
      environment: 'production',
      status: 'active',
    });

    if (!credential) {
      createdCredential = true;
      if (!dryRun && application) {
        credential = await ApplicationCredential.create({
          applicationId,
          name: 'Production',
          publicKey: generatePublicKey(),
          // public client → NO secret / secretHash (mirrors routes/applications.ts)
          type: 'public',
          environment: 'production',
          scopes: ['user:read'],
          status: 'active',
          createdByUserId: oxyId,
        });
        credentialsCreated += 1;
      }
    } else {
      credentialsReused += 1;
    }

    mapping.push({
      app: spec.name,
      type: spec.type,
      applicationId: applicationId.toString(),
      clientId: credential?.publicKey ?? (dryRun ? '(dry-run-not-minted)' : 'ERROR'),
      redirectUris: spec.redirectUris,
      websiteUrl: spec.websiteUrl,
      createdApplication,
      createdMember,
      createdCredential,
    });
  }

  logger.info('Seed summary', {
    dryRun,
    apps: SEED_APPS.length,
    appsCreated,
    appsUpdated,
    membersCreated,
    credentialsCreated,
    credentialsReused,
  });

  // Read-back proof: count applications owned by oxy + list cred publicKeys.
  const ownedAppCount = await Application.countDocuments({ createdByUserId: oxyId });
  logger.info('Read-back: applications owned by oxy', { count: ownedAppCount });

  // Emit the mapping as a single parseable JSON line.
  // eslint-disable-next-line no-console
  console.log('OXY_APP_MAPPING_JSON=' + JSON.stringify(mapping));
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
    await seed();
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
}

main().catch((error) => {
  logger.error(
    'Seed failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'seed-oxy-applications', method: 'main' },
  );
  process.exit(1);
});
