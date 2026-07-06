#!/usr/bin/env bun
/**
 * Idempotent seed: register a first-party / internal `Application` record for
 * every official Oxy app in the ecosystem, owned by the platform user `oxy`.
 *
 * For each app this UPSERTS (never duplicates on re-run):
 *   - Application      keyed by (name + createdByUserId = oxyId), owned by the
 *                      minted Oxy `kind:'organization'` account (ownerAccountId)
 *   - AccountMember    a single owner membership for oxy on the Oxy org account
 *                      (app access derives from it — no per-app member row)
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
import { Application, type IApplication } from '../src/models/Application';
import { ApplicationCredential } from '../src/models/ApplicationCredential';
import AccountMember from '../src/models/AccountMember';
import { User } from '../src/models/User';
import { permissionsForAccountRole } from '../src/utils/accountRoles';
import { logger } from '../src/utils/logger';
import {
  unionValidScopes,
  type ApplicationScope,
} from '../src/utils/applicationScopes';

// ── Mirror routes/applications.ts credential generation EXACTLY ──────────────
const CREDENTIAL_PUBLIC_KEY_PREFIX = 'oxy_dk_';
const PUBLIC_KEY_RANDOM_BYTES = 24;

function generatePublicKey(): string {
  return CREDENTIAL_PUBLIC_KEY_PREFIX + crypto.randomBytes(PUBLIC_KEY_RANDOM_BYTES).toString('hex');
}

type AppType = 'first_party' | 'internal';

interface SeedAppSpec {
  name: string;
  /**
   * Previous official seed names that should be migrated in-place when present.
   *
   * The seed remains keyed by name for ordinary idempotency, but official app
   * renames must not leave the old active app/credential trusted forever. If a
   * legacy row exists and the new row does not, it is renamed/reconciled in
   * place so the existing client id is preserved. If both rows already exist,
   * the legacy row is suspended and its credentials are revoked.
   */
  legacyNames?: string[];
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

/**
 * The official Oxy ecosystem apps that integrate Oxy auth.
 * `name` is the idempotency key (with createdByUserId=oxyId) — DO NOT rename
 * casually, a rename creates a new Application rather than updating one.
 *
 * `redirectUris` are OAuth redirect URIs. Trust derivation
 * (`dynamicOriginRegistry`, FedCM approved clients) keys on the ORIGIN of each
 * URI, so web apps register their apex origin as the redirect surface; native
 * apps register their deep-link schemes.
 */
const SEED_APPS: SeedAppSpec[] = [
  // ── OxyHQServices first-party web apps (CF Pages) ──
  {
    name: 'Oxy Accounts',
    description: 'Official Oxy account management app (My Account).',
    websiteUrl: 'https://accounts.oxy.so',
    type: 'first_party',
    redirectUris: ['https://accounts.oxy.so'],
  },
  {
    name: 'Oxy Console',
    description: 'Official Oxy developer console (Cloud).',
    websiteUrl: 'https://console.oxy.so',
    type: 'first_party',
    redirectUris: ['https://console.oxy.so'],
  },
  {
    name: 'Oxy Inbox',
    description: 'Official Oxy email/inbox app.',
    websiteUrl: 'https://inbox.oxy.so',
    type: 'first_party',
    redirectUris: ['https://inbox.oxy.so'],
  },
  {
    name: 'Oxy Auth',
    description: 'Official Oxy authentication app and third-party OAuth Identity Provider.',
    websiteUrl: 'https://auth.oxy.so',
    type: 'first_party',
    // The auth app is the third-party OAuth IdP, but it now ALSO consumes
    // Sign-in-with-Oxy as its own Relying Party, so it registers its own
    // origin as the redirect surface.
    redirectUris: ['https://auth.oxy.so'],
  },
  // ── Ecosystem first-party apps ──
  {
    name: 'Mention',
    description: 'Official Oxy social media app with fediverse support.',
    websiteUrl: 'https://mention.earth',
    type: 'first_party',
    redirectUris: ['https://mention.earth'],
    // Mention federates: its service credential signs HTTP-Signatures and
    // resolves federated users. The mint intersects credential scopes with these
    // app scopes, so the app MUST carry federation:write for the credential's
    // federation:write to survive. files:write is needed for federated-media S3
    // caching (POST /assets/service/cache); files:read for reading cached assets
    // back (GET /assets/service/*). signals:write lets Mention push cross-app
    // recommendation signals (interest + interaction-affinity edges) — the
    // credential already carries it, so the app MUST declare it or the mint's
    // intersection drops it.
    scopes: ['user:read', 'files:read', 'files:write', 'federation:write', 'signals:write'],
  },
  {
    name: 'Homiio',
    description: 'Official Oxy real estate platform.',
    websiteUrl: 'https://homiio.com',
    type: 'first_party',
    redirectUris: ['https://homiio.com'],
  },
  {
    name: 'Allo',
    description: 'Official Oxy encrypted messaging app.',
    websiteUrl: 'https://allo.oxy.so',
    type: 'first_party',
    redirectUris: ['https://allo.oxy.so'],
  },
  {
    name: 'Alia',
    description: 'Official Oxy AI platform (chat app, console, canvas, gateway).',
    websiteUrl: 'https://alia.onl',
    type: 'first_party',
    redirectUris: ['https://alia.onl'],
  },
  {
    name: 'Syra',
    description: 'Official Oxy app.',
    websiteUrl: 'https://syra.oxy.so',
    type: 'first_party',
    redirectUris: ['https://syra.oxy.so'],
  },
  {
    name: 'TNP',
    description: 'Official Oxy alternative DNS/namespace system.',
    websiteUrl: 'https://tnp.network',
    type: 'first_party',
    redirectUris: ['https://tnp.network'],
  },
  {
    name: 'Oxy Website',
    description: 'Official Oxy / FairCoin marketing website.',
    websiteUrl: 'https://oxy.so',
    type: 'first_party',
    redirectUris: ['https://oxy.so', 'https://fairco.in'],
  },
  {
    name: 'Oxy Pay',
    description: 'Official Oxy payments app.',
    websiteUrl: 'https://pay.oxy.so',
    type: 'first_party',
    redirectUris: ['https://pay.oxy.so'],
  },
  {
    name: 'Noted',
    description: 'Official Oxy notes app.',
    websiteUrl: 'https://noted.oxy.so',
    type: 'first_party',
    redirectUris: ['https://noted.oxy.so'],
  },
  {
    name: 'Commons by Oxy',
    description:
      'Official Oxy Commons app — self-sovereign identity wallet and Sign-in-with-Oxy approvals (native).',
    type: 'first_party',
    // Commons is native-only (no web). Its public client id (the credential
    // publicKey) wires into OxyProvider; the redirect surface is the app's two
    // deep-link schemes from packages/commons/app.json, so both are listed.
    redirectUris: ['commons://', 'oxycommons://'],
  },
  {
    name: 'Mercaria',
    legacyNames: ['Marketplace'],
    description: 'Official Oxy marketplace app — buy and sell new and secondhand items.',
    websiteUrl: 'https://mercaria.co',
    type: 'first_party',
    // Storefront (mercaria.co) + the two first-party admin surfaces that share
    // this client: the store/merchant dashboard and the point-of-sale app.
    // Trust derivation matches the RP by the origin of an approved redirect
    // URI, so each subdomain's origin is listed here.
    redirectUris: [
      'https://mercaria.co',
      'https://dashboard.mercaria.co',
      'https://pos.mercaria.co',
    ],
  },
  {
    name: 'Moovo',
    description: 'Official Oxy courier/transport app — send packages, food, and moves.',
    websiteUrl: 'https://moovo.now',
    type: 'first_party',
    redirectUris: [
      'https://moovo.now',
      'https://go.moovo.now',
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
  createdCredential: boolean;
}

async function retireLegacyApplication(
  application: mongoose.Document<unknown, object, IApplication> & IApplication,
  dryRun: boolean,
): Promise<number> {
  if (dryRun) {
    return 0;
  }

  application.status = 'suspended';
  application.redirectUris = [];
  await application.save();

  const result = await ApplicationCredential.updateMany(
    {
      applicationId: application._id,
      status: { $ne: 'revoked' },
    },
    { $set: { status: 'revoked' } },
  );

  return result.modifiedCount ?? 0;
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

  // ── Oxy organization account: every seeded official app is owned by it ──
  // The unified Account model owns apps via `Application.ownerAccountId`. We mint
  // (idempotently) a `kind:'organization'` account named "Oxy" parented under the
  // `oxy` user, and make `oxy` its owner via a single AccountMember row. App
  // access then derives from that membership — there is no per-app member row.
  const oxyAccountName = process.env.OXY_ACCOUNT_NAME || 'Oxy';
  let oxyOrg = await User.findOne({
    parentAccountId: oxyId,
    kind: 'organization',
    'name.first': oxyAccountName,
  });
  if (!oxyOrg && !dryRun) {
    const baseUsername = `${ownerUsername}-org`;
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
  const oxyOrgId = oxyOrg?._id ?? new mongoose.Types.ObjectId('000000000000000000000000');

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
  logger.info('Oxy organization account', {
    name: oxyAccountName,
    ownerAccountId: oxyOrgId.toString(),
    created: !!oxyOrg && oxyOrg.isNew,
  });

  const mapping: MappingRow[] = [];

  let appsCreated = 0;
  let appsUpdated = 0;
  let legacyAppsRetired = 0;
  let credentialsCreated = 0;
  let legacyCredentialsRevoked = 0;
  let credentialsReused = 0;

  for (const spec of SEED_APPS) {
    let createdApplication = false;
    let createdCredential = false;

    // ── Application: upsert keyed by (name, createdByUserId) ──
    // Official app renames include legacyNames so a pre-existing row is
    // reconciled in-place instead of leaving stale redirect origins trusted.
    let application = await Application.findOne({ name: spec.name, createdByUserId: oxyId });
    const legacyApplications =
      spec.legacyNames && spec.legacyNames.length > 0
        ? await Application.find({
            name: { $in: spec.legacyNames },
            createdByUserId: oxyId,
          })
        : [];

    if (!application && legacyApplications.length > 0) {
      application = legacyApplications[0];
      application.name = spec.name;
    }

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
      ownerAccountId: oxyOrgId,
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
      // Additive union: keep any valid already-granted scope so a re-run never
      // silently revokes an out-of-band grant (e.g. Mention's signals:write).
      application.scopes = unionValidScopes(desiredAppFields.scopes, application.scopes);
      application.ownerAccountId = desiredAppFields.ownerAccountId;
      if (application.isModified()) {
        await application.save();
        appsUpdated += 1;
      }
    }

    for (const legacyApplication of legacyApplications) {
      if (application && legacyApplication._id.equals(application._id)) {
        continue;
      }

      legacyCredentialsRevoked += await retireLegacyApplication(legacyApplication, dryRun);
      legacyAppsRetired += 1;
    }

    // In dry-run with a not-yet-existing app, synthesize a placeholder id.
    const applicationId =
      application?._id ?? new mongoose.Types.ObjectId('000000000000000000000000');

    // Ownership/membership is handled ONCE at the org-account level above — app
    // access for `oxy` derives from the Oxy org `AccountMember` (no per-app row).

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
      createdCredential,
    });
  }

  logger.info('Seed summary', {
    dryRun,
    apps: SEED_APPS.length,
    appsCreated,
    appsUpdated,
    credentialsCreated,
    legacyAppsRetired,
    legacyCredentialsRevoked,
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
