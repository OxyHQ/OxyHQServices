/**
 * Representative source documents for every mapped collection.
 *
 * Written from the MONGOOSE MODELS — `models/*.ts` — not from the transforms,
 * and the direction matters: a fixture derived from the transform would agree
 * with it by construction and prove nothing. These say "this is the shape
 * production holds", and the transform has to cope.
 *
 * Ids are FIXED rather than generated so a failure names the same id every run.
 * They are laid out so the foreign-key graph is satisfiable: `USER_A` is a
 * personal account, `ORG` is an organisation, `SUB` is a sub-account of `ORG`
 * (which exercises the deferred self-reference on `users.parent_account_id`),
 * and everything else hangs off those three plus `APPLICATION`.
 *
 * {@link DIRTY_FIXTURES} is separate and deliberately invalid — see its own
 * doc comment.
 */

import { oid } from './mongoTestSource';

/** A source document as it would sit in a collection. */
export type FixtureDocument = Record<string, unknown>;

/** Collection name → its documents. */
export type FixtureSet = Record<string, FixtureDocument[]>;

// ---------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------

export const USER_A = '68a1000000000000000000a1';
export const ORG = '68a1000000000000000000a2';
export const SUB = '68a1000000000000000000a3';
export const USER_B = '68a1000000000000000000a4';
export const APPLICATION = '68a1000000000000000000b1';
export const APP_CREDENTIAL = '68a1000000000000000000b2';
export const FILE_USER = '68a1000000000000000000c1';
export const FILE_FEDERATION = '68a1000000000000000000c2';
export const FILE_LINK_PREVIEW = '68a1000000000000000000c3';
export const MAILBOX = '68a1000000000000000000d1';
export const MESSAGE = '68a1000000000000000000d2';
export const UPDATE_CHANNEL = '68a1000000000000000000e1';
export const APP_UPDATE = '68a1000000000000000000e2';
export const REPUTATION_TXN = '68a1000000000000000000f1';
export const MODERATION_POLICY = '68a1000000000000000000f2';
export const IDENTITY_BINDING = '68a1000000000000000000f3';
export const CONDUCT_STRIKE = '68a1000000000000000000f4';
export const SIGNED_RECORD = '68a10000000000000000010a';
export const VALIDATION_REQUEST = '68a10000000000000000010b';
export const TRANSPARENCY_CHECKPOINT = '68a10000000000000000010c';
export const DEVICE_SESSION = '68a10000000000000000010d';
export const SESSION = '68a10000000000000000010e';
export const EMAIL_FILTER = '68a10000000000000000010f';

// ---- ids for the documented-resolution fixtures ---------------------------
//
// Separate from the clean ids so a failure says which class of document it was
// about, and separate from the `68ab…` dirty ids because these documents are
// NOT refused — they are copied, with a recorded change.

/** A message whose `card.type` holds card METADATA, the production shape. */
export const MESSAGE_CORRUPT_CARD = '68ac000000000000000000a1';
/** A message with a perfectly good card. The control: it must survive intact. */
export const MESSAGE_VALID_CARD = '68ac000000000000000000a2';

/** The `sourceActionId` 13 production requests hold open. Three here. */
export const DUPLICATE_ACTION_KEY = 'personhood_audit:69b2d3df5d12f58c9800d651';
/** The second production group. Two here, and neither carries a `createdAt`. */
export const DUPLICATE_ACTION_KEY_UNTIMED = 'personhood_audit:6981c9178fcdefaf81988ffb';

/** `DUPLICATE_ACTION_KEY`, oldest `createdAt` — demoted. */
export const DUP_REQUEST_OLDEST = '68ac000000000000000000b1';
/** `DUPLICATE_ACTION_KEY`, middle `createdAt`, `quorum_met` — demoted. */
export const DUP_REQUEST_MIDDLE = '68ac000000000000000000b2';
/** `DUPLICATE_ACTION_KEY`, newest `createdAt` — SURVIVES. */
export const DUP_REQUEST_NEWEST = '68ac000000000000000000b3';

// No `createdAt` on either of these two, so the ONLY thing that can order them
// is the instant their own ObjectId carries in its first four bytes. The hex is
// chosen so `…c2` is unambiguously the newer of the pair (0x68ac0200 >
// 0x68ac0100) — a fallback that ordered them the other way would keep `…c1`.
/** `DUPLICATE_ACTION_KEY_UNTIMED`, older ObjectId timestamp — demoted. */
export const DUP_UNTIMED_OLDER = '68ac010000000000000000c1';
/** `DUPLICATE_ACTION_KEY_UNTIMED`, newer ObjectId timestamp — SURVIVES. */
export const DUP_UNTIMED_NEWER = '68ac020000000000000000c2';

// Two CLOSED requests sharing `DUPLICATE_ACTION_KEY` with the open group above.
// They are legal in Postgres — the unique index is PARTIAL on the open statuses,
// so a closed row cannot collide with anything — and they exist to pin that the
// audit asks the index's question rather than a wider one. An audit that ignores
// the partial predicate groups all five, and the rule (which correctly demotes
// all but one of the three OPEN rows) then fails to cover the padded group and
// blocks the copy over data that was never a problem. That is the exact shape
// production hit: 13 and 10 documents reported where only a handful were open.
/** `DUPLICATE_ACTION_KEY`, already `expired` — must NEVER be reported or touched. */
export const DUP_CLOSED_EXPIRED = '68ac030000000000000000d1';
/** `DUPLICATE_ACTION_KEY`, already `resolved` — must NEVER be reported or touched. */
export const DUP_CLOSED_RESOLVED = '68ac040000000000000000d2';

/** The content address `signed_records.record_id` and its five referrers share. */
export const RECORD_ID = 'bafyrecord0000000000000000000001';
/** The SHA-256 an `update_assets` row is keyed by. */
export const ASSET_SHA = 'b'.repeat(64);

const T0 = new Date('2026-01-02T03:04:05.000Z');
const T1 = new Date('2026-02-03T04:05:06.000Z');
const FUTURE = new Date('2027-01-01T00:00:00.000Z');

/**
 * One document per mapped collection, exercising every child-table
 * decomposition and both id shapes.
 */
export function cleanFixtures(): FixtureSet {
  return {
    // ---- users and the social graph --------------------------------------
    users: [
      {
        _id: oid(USER_A),
        username: 'nate',
        email: 'nate@oxy.so',
        phone: '+15550000001',
        publicKey: 'AA'.repeat(33),
        refreshToken: 'legacy-refresh',
        name: { first: 'Nate', last: 'Isern' },
        kind: 'personal',
        accountStatus: 'active',
        type: 'local',
        verified: true,
        isStaff: true,
        languages: ['en-US', 'es-ES'],
        avatar: FILE_USER,
        color: 'oxy',
        bio: 'bio',
        links: ['https://oxy.so'],
        linksMetadata: [
          { url: 'https://oxy.so', title: 'Oxy', description: 'Home', image: 'img' },
        ],
        // Two locations: one with coordinates, one without — the CHECK requires
        // both halves or neither.
        locations: [
          {
            _id: oid('68a2000000000000000001a1'),
            id: 'home',
            name: 'Home',
            label: 'Casa',
            type: 'home',
            address: {
              street: 'Carrer Gran',
              streetNumber: '1',
              postalCode: '08001',
              city: 'Barcelona',
              state: 'Catalunya',
              country: 'Spain',
              formattedAddress: 'Carrer Gran 1, Barcelona',
            },
            coordinates: { lat: 41.3874, lon: 2.1686 },
            placeId: 'place-1',
            countryCode: 'ES',
            timezone: 'Europe/Madrid',
          },
          {
            _id: oid('68a2000000000000000001a2'),
            id: 'work',
            name: 'Work',
            type: 'work',
            address: { city: 'Barcelona', country: 'Spain' },
          },
        ],
        authMethods: [
          {
            _id: oid('68a2000000000000000001b1'),
            type: 'identity',
            linkedAt: T0,
            // NESTED under `metadata`, per the model — the identifier
            // `user_auth_methods_identifier_check` requires for an `identity`
            // method.
            metadata: { publicKey: 'AA'.repeat(33), name: 'Commons key' },
          },
        ],
        verifiedDomains: [{ _id: oid('68a2000000000000000001c1'), domain: 'oxy.so', verifiedAt: T0, method: 'dns-txt' }],
        privacySettings: { isPrivateAccount: false, discoverableByEmail: true },
        notificationPreferences: { pushEnabled: true },
        userPreferences: { language: 'en', theme: 'dark', timezone: 'Europe/Madrid' },
        themePreference: { mode: 'dark', colorPreset: 'oxy' },
        autoReply: { enabled: false, subject: '', body: '' },
        federation: {},
        createdAt: T0,
        updatedAt: T1,
      },
      {
        _id: oid(ORG),
        username: 'oxy',
        email: 'hello@oxy.so',
        name: { first: 'Oxy' },
        kind: 'organization',
        organizationCategory: 'other',
        accountStatus: 'active',
        type: 'local',
        color: 'blue',
        createdAt: T0,
        updatedAt: T0,
      },
      {
        // A sub-account whose parent sorts LATER by `_id` would break an
        // immediate FK; this one sorts later than its parent, and the deferred
        // pass covers both directions regardless.
        _id: oid(SUB),
        username: 'oxy-bot',
        name: { first: 'Bot' },
        kind: 'bot',
        parentAccountId: oid(ORG),
        rootAccountId: oid(ORG),
        automation: { ownerId: USER_A },
        accountStatus: 'active',
        type: 'automated',
        color: 'mint',
        // A plain ObjectId array ordered ROOT FIRST — `[...parent.ancestors,
        // parent._id]` — so the array index IS `depth` and `depth = 0` is the
        // tree root. NOT subdocuments.
        ancestors: [oid(ORG)],
        createdAt: T0,
        updatedAt: T0,
      },
      {
        _id: oid(USER_B),
        username: 'someone',
        email: 'someone@example.com',
        name: { first: 'Some', last: 'One' },
        kind: 'personal',
        accountStatus: 'active',
        type: 'local',
        color: 'teal',
        createdAt: T0,
        updatedAt: T0,
      },
    ],

    follows: [
      {
        _id: oid('68a3000000000000000000a1'),
        followerUserId: oid(USER_A),
        followedId: oid(USER_B),
        followType: 'user',
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    blocks: [{ _id: oid('68a3000000000000000000a2'), userId: oid(USER_A), blockedId: oid(USER_B), createdAt: T0 }],
    restricteds: [
      { _id: oid('68a3000000000000000000a3'), userId: oid(USER_A), restrictedId: oid(USER_B), createdAt: T0 },
    ],
    bookmarks: [
      {
        _id: oid('68a3000000000000000000a4'),
        userId: oid(USER_A),
        postId: oid('68a3000000000000000000ff'),
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    notifications: [
      {
        _id: oid('68a3000000000000000000a5'),
        recipientId: oid(USER_A),
        actorId: oid(USER_B),
        type: 'follow',
        entityId: oid(USER_B),
        entityType: 'profile',
        read: false,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    contacts: [
      {
        _id: oid('68a3000000000000000000a6'),
        userId: oid(USER_A),
        name: 'Contact',
        email: 'contact@example.com',
        company: 'ACME',
        starred: true,
        autoCollected: false,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    analytics: [
      {
        _id: oid('68a3000000000000000000a7'),
        userID: oid(USER_A),
        period: 'daily',
        date: T0,
        stats: {
          postViews: 10,
          profileViews: 3,
          engagement: { likes: 1, replies: 2, reposts: 0, quotes: 0, bookmarks: 4 },
          reach: { impressions: 100, uniqueViewers: 50 },
          demographics: { countries: { ES: 3 }, languages: { en: 7 } },
          peakActivity: { hour: 13, count: 9 },
        },
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    userappdatas: [
      {
        _id: oid('68a3000000000000000000a8'),
        userId: oid(USER_A),
        namespace: 'mention',
        key: 'prefs',
        value: { theme: 'dark' },
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    usernodes: [
      {
        _id: oid('68a3000000000000000000a9'),
        userId: oid(USER_A),
        endpoint: 'https://node.example',
        nodePublicKey: 'CC'.repeat(33),
        mode: 'pull',
        managed: false,
        controller: 'self',
        status: 'active',
        cursor: 4,
        createdAt: T0,
        updatedAt: T0,
      },
    ],

    // ---- applications and credentials -------------------------------------
    applications: [
      {
        _id: oid(APPLICATION),
        name: 'Commons',
        description: 'Identity vault',
        type: 'first_party',
        status: 'active',
        isOfficial: true,
        isInternal: false,
        capabilities: ['identity:approval'],
        redirectUris: ['https://commons.oxy.so/cb'],
        scopes: ['user:read'],
        ownerAccountId: oid(ORG),
        createdByUserId: oid(USER_A),
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    applicationcredentials: [
      {
        _id: oid(APP_CREDENTIAL),
        applicationId: oid(APPLICATION),
        name: 'default',
        publicKey: 'oxy_dk_test',
        secretHash: 'd'.repeat(64),
        type: 'public',
        environment: 'production',
        scopes: ['user:read'],
        status: 'active',
        createdByUserId: oid(USER_A),
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    accountcredentials: [
      {
        _id: oid('68a4000000000000000000a1'),
        accountId: oid(ORG),
        name: 'svc',
        publicKey: 'oxy_ak_test',
        secretHash: 'e'.repeat(64),
        type: 'service',
        environment: 'production',
        scopes: ['user:read'],
        status: 'active',
        createdByUserId: oid(USER_A),
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    accountmembers: [
      {
        _id: oid('68a4000000000000000000a2'),
        accountId: oid(ORG),
        memberUserId: oid(USER_A),
        role: 'owner',
        inherit: true,
        status: 'active',
        joinedAt: T0,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    appgrants: [
      {
        _id: oid('68a4000000000000000000a3'),
        userId: oid(USER_A),
        applicationId: oid(APPLICATION),
        scopes: ['user:read'],
        firstGrantedAt: T0,
        lastUsedAt: T1,
        createdAt: T0,
        updatedAt: T1,
      },
    ],
    developerapikeys: [
      {
        _id: oid('68a4000000000000000000a4'),
        userId: USER_A,
        appId: oid(APPLICATION),
        name: 'key',
        keyHash: 'f'.repeat(64),
        keyPrefix: 'oxy_sk',
        scopes: ['models:read'],
        isActive: true,
        rateLimit: { requestsPerMinute: 60, requestsPerDay: 1000 },
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    apikeyusages: [
      {
        _id: oid('68a4000000000000000000a5'),
        apiKeyId: oid('68a4000000000000000000a4'),
        userId: USER_A,
        appId: oid(APPLICATION),
        endpoint: '/v1/chat',
        method: 'POST',
        statusCode: 200,
        tokensUsed: 12,
        creditsUsed: 0.5,
        responseTime: 120.5,
        authType: 'api_key',
        timestamp: T0,
      },
    ],
    appusersignals: [
      {
        _id: oid('68a4000000000000000000a6'),
        applicationId: oid(APPLICATION),
        userId: oid(USER_A),
        endorsementScore: 1.5,
        interestScore: 0.25,
        endorsementCount: 2,
        lastEndorsedAt: T1,
        createdAt: T0,
        updatedAt: T1,
      },
    ],
    appaffinityedges: [
      {
        _id: oid('68a4000000000000000000a7'),
        applicationId: oid(APPLICATION),
        fromUserId: oid(USER_A),
        toUserId: oid(USER_B),
        affinity: 0.75,
        eventCount: 3,
        lastEventAt: T1,
        createdAt: T0,
        updatedAt: T1,
      },
    ],
    appaffinityeventseens: [
      {
        _id: oid('68a4000000000000000000a8'),
        applicationId: oid(APPLICATION),
        eventId: 'evt-1',
        createdAt: T0,
      },
    ],
    appendorsementedges: [
      {
        _id: oid('68a4000000000000000000a9'),
        applicationId: oid(APPLICATION),
        ownerId: oid(USER_A),
        memberId: oid(USER_B),
        sourceId: 'src-1',
        weight: 1,
        createdAt: T0,
        updatedAt: T0,
      },
    ],

    // ---- updates ----------------------------------------------------------
    updateassets: [
      {
        _id: oid('68a5000000000000000000a1'),
        sha256: ASSET_SHA,
        s3Key: `updates/${ASSET_SHA}`,
        contentType: 'application/javascript',
        size: 1024,
        status: 'uploaded',
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    updatechannels: [
      {
        _id: oid(UPDATE_CHANNEL),
        applicationId: oid(APPLICATION),
        name: 'production',
        rollbacksToEmbedded: [
          { runtimeVersion: '1.0.0', platform: 'ios', commitTime: T0 },
        ],
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    appupdates: [
      {
        _id: oid(APP_UPDATE),
        // `app_updates_update_id_check` requires a UUID — the expo-updates
        // protocol's own id format, not a free-form string.
        updateId: '018f5a2c-1c2d-7e3a-9b4c-5d6e7f809a1b',
        applicationId: oid(APPLICATION),
        channelId: oid(UPDATE_CHANNEL),
        runtimeVersion: '1.0.0',
        platform: 'ios',
        status: 'published',
        launchAsset: {
          sha256: ASSET_SHA,
          key: `updates/${ASSET_SHA}`,
          contentType: 'application/javascript',
          fileExtension: '.bundle',
        },
        assets: [
          {
            sha256: ASSET_SHA,
            key: `updates/${ASSET_SHA}`,
            contentType: 'application/javascript',
            fileExtension: '.js',
          },
        ],
        extra: { expoClient: { name: 'commons' } },
        metadata: {},
        rolloutPercent: 100,
        createdAt: T0,
        updatedAt: T0,
      },
    ],

    // ---- billing ----------------------------------------------------------
    billingsubscriptions: [
      {
        _id: oid('68a6000000000000000000a1'),
        userId: USER_A,
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_1',
        status: 'active',
        currentPeriodStart: T0,
        currentPeriodEnd: FUTURE,
        cancelAtPeriodEnd: false,
        plan: { name: 'Pro', creditsPerMonth: 1000, price: 2999, currency: 'usd' },
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    billingtransactions: [
      {
        _id: oid('68a6000000000000000000a2'),
        userId: USER_A,
        stripeCustomerId: 'cus_1',
        stripePaymentIntentId: 'pi_1',
        type: 'credit_purchase',
        amount: 2999,
        currency: 'usd',
        credits: 1000,
        status: 'completed',
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    subscriptions: [
      {
        _id: oid('68a6000000000000000000a3'),
        userId: oid(USER_A),
        plan: 'pro',
        status: 'active',
        startDate: T0,
        endDate: FUTURE,
        autoRenew: true,
        features: { analytics: true, premiumBadge: true },
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    transactions: [
      {
        _id: oid('68a6000000000000000000a4'),
        userId: oid(USER_A),
        type: 'transfer',
        amount: 12.5,
        status: 'completed',
        recipientId: oid(USER_B),
        completedAt: T1,
        createdAt: T0,
        updatedAt: T1,
      },
    ],
    wallets: [
      { _id: oid('68a6000000000000000000a5'), userId: oid(USER_A), balance: 42.25, address: 'fc1abc', createdAt: T0, updatedAt: T0 },
    ],
    usercredits: [
      {
        // A STRING `_id` holding the userId — the shape that breaks a
        // "24 hex ⇒ ObjectId" checkpoint inference.
        _id: USER_A,
        credits: { free: 1000, freeLimit: 1000, dailyRefresh: 300, paid: 25, lastRefresh: T0 },
        stripeCustomerId: 'cus_1',
        createdAt: T0,
        updatedAt: T0,
      },
    ],

    // ---- files and mail ---------------------------------------------------
    files: [
      {
        _id: oid(FILE_USER),
        sha256: 'a'.repeat(64),
        size: 2048,
        mime: 'image/png',
        ext: 'png',
        ownerUserId: USER_A,
        status: 'active',
        visibility: 'public',
        purpose: 'user',
        storageKey: 'assets/a',
        originalName: 'avatar.png',
        metadata: { width: 100, height: 100 },
        links: [
          { app: 'mention', entityType: 'post', entityId: 'post-1', createdBy: USER_A, createdAt: T0 },
        ],
        variants: [
          { type: 'thumbnail', key: 'assets/a-thumb', width: 32, height: 32, readyAt: T1, size: 256 },
        ],
        createdAt: T0,
        updatedAt: T1,
      },
      {
        _id: oid(FILE_FEDERATION),
        sha256: 'c'.repeat(64),
        size: 512,
        mime: 'image/jpeg',
        ext: 'jpg',
        // The sentinel split: this must land in `system_owner`, NOT
        // `owner_user_id`.
        ownerUserId: '__federation__',
        status: 'active',
        visibility: 'public',
        purpose: 'federation-media-cache',
        storageKey: 'assets/c',
        createdAt: T0,
        updatedAt: T0,
      },
      {
        _id: oid(FILE_LINK_PREVIEW),
        sha256: 'd'.repeat(64),
        size: 256,
        mime: 'image/webp',
        ext: 'webp',
        ownerUserId: '__link_preview_cache__',
        status: 'active',
        visibility: 'public',
        purpose: 'link-preview',
        storageKey: 'assets/d',
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    mailboxes: [
      {
        _id: oid(MAILBOX),
        userId: oid(USER_A),
        name: 'INBOX',
        path: 'INBOX',
        specialUse: '\\Inbox',
        totalMessages: 1,
        unseenMessages: 1,
        size: 900,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    messages: [
      {
        _id: oid(MESSAGE),
        userId: oid(USER_A),
        mailboxId: oid(MAILBOX),
        messageId: '<msg-1@example.com>',
        from: { name: 'Sender', address: 'sender@example.com' },
        to: [
          { name: 'Nate', address: 'nate@oxy.so' },
          { name: '', address: 'other@oxy.so' },
        ],
        cc: [{ name: 'Cc', address: 'cc@example.com' }],
        bcc: [],
        replyTo: { name: 'Reply', address: 'reply@example.com' },
        subject: 'Hello',
        text: 'Body',
        html: '<p>Body</p>',
        headers: new Map([['received', 'from mx']]),
        attachments: [
          {
            fileId: FILE_USER,
            name: 'avatar.png',
            contentType: 'image/png',
            size: 2048,
            contentId: null,
            isInline: false,
          },
        ],
        flags: { seen: false, starred: true, answered: false, forwarded: false, draft: false, pinned: false },
        labels: ['work'],
        card: { type: 'purchase', data: { total: 10 }, confidence: 0.9, extractedAt: T1 },
        highlights: [{ type: 'amount', value: '10', label: 'Total' }],
        encrypted: false,
        size: 900,
        references: ['<ref-1@example.com>'],
        readReceiptRequested: false,
        readReceiptSent: false,
        date: T0,
        receivedAt: T0,
        createdAt: T0,
        updatedAt: T1,
      },
    ],
    labels: [
      { _id: oid('68a7000000000000000000a1'), userId: oid(USER_A), name: 'Work', color: '#4285f4', order: 0, createdAt: T0, updatedAt: T0 },
    ],
    bundles: [
      {
        _id: oid('68a7000000000000000000a2'),
        userId: oid(USER_A),
        name: 'Receipts',
        icon: 'folder-outline',
        color: '#5F6368',
        matchLabels: ['work'],
        enabled: true,
        collapsed: true,
        order: 0,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    emailtemplates: [
      { _id: oid('68a7000000000000000000a3'), userId: oid(USER_A), name: 'Reply', subject: 'Re:', body: 'Hi', order: 0, createdAt: T0, updatedAt: T0 },
    ],
    emailfilters: [
      {
        _id: oid(EMAIL_FILTER),
        userId: oid(USER_A),
        name: 'Filter',
        enabled: true,
        matchAll: true,
        order: 0,
        conditions: [
          { field: 'from', operator: 'contains', value: 'example.com' },
          { field: 'subject', operator: 'equals', value: 'Hello' },
        ],
        actions: [
          { type: 'label', value: 'work' },
          { type: 'mark-read' },
        ],
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    senderavatars: [
      {
        _id: oid('68a7000000000000000000a5'),
        email: 'sender@example.com',
        avatarPath: 'avatars/sender',
        source: 'gravatar',
        resolvedAt: T0,
        expiresAt: FUTURE,
      },
    ],
    reminders: [
      {
        _id: oid('68a7000000000000000000a6'),
        userId: oid(USER_A),
        text: 'Follow up',
        remindAt: FUTURE,
        completed: false,
        pinned: false,
        relatedMessageId: oid(MESSAGE),
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    linkpreviews: [
      {
        // A SHA-256 string `_id`, content-addressed.
        _id: 'e'.repeat(64),
        requestedUrl: 'https://example.com/a',
        canonicalUrl: 'https://example.com/a',
        title: 'Example',
        description: 'An example',
        siteName: 'Example',
        imageUrl: 'https://cdn.example.com/i.png',
        originImageUrl: 'https://origin.example.com/i.png',
        status: 'resolved',
        version: 1,
        resolvedAt: T1,
        createdAt: T0,
        updatedAt: T1,
      },
    ],
    topics: [
      {
        _id: oid('68a7000000000000000000a8'),
        name: 'technology',
        slug: 'technology',
        displayName: 'Technology',
        description: 'Tech',
        type: 'category',
        source: 'seed',
        aliases: ['tech'],
        isActive: true,
        translations: new Map([['es', { displayName: 'Tecnología', description: 'Tec' }]]),
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    federation_keypairs: [
      {
        _id: oid('68a7000000000000000000a9'),
        keyId: 'https://oxy.so/ap/actor#main-key',
        publicKeyPem: '-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\nBBB\n-----END PRIVATE KEY-----',
        createdAt: T0,
        updatedAt: T0,
      },
    ],

    // ---- auth and sessions ------------------------------------------------
    sessions: [
      {
        _id: oid(SESSION),
        sessionId: 'sess-1',
        userId: oid(USER_A),
        deviceId: 'dev-1',
        deviceInfo: {
          deviceType: 'desktop',
          platform: 'web',
          browser: 'Chrome',
          os: 'Linux',
          deviceName: 'Laptop',
          userAgent: 'Mozilla/5.0',
          fingerprint: 'fp-1',
          lastActive: T1,
        },
        accessToken: 'at-1',
        refreshToken: 'rt-1',
        isActive: true,
        expiresAt: FUTURE,
        lastRefresh: T1,
        createdAt: T0,
        updatedAt: T1,
      },
    ],
    devicesessions: [
      {
        _id: oid(DEVICE_SESSION),
        deviceId: 'dev-1',
        accounts: [
          { accountId: oid(USER_A), sessionId: 'sess-1', authuser: 0, addedAt: T0 },
          { accountId: oid(USER_B), sessionId: 'sess-2', authuser: 1, addedAt: T1, operatedByUserId: oid(USER_A) },
        ],
        activeAccountId: oid(USER_A),
        secretHash: 'a1'.repeat(32),
        revision: 3,
        createdAt: T0,
        updatedAt: T1,
      },
    ],
    authchallenges: [
      {
        _id: oid('68a8000000000000000000a1'),
        publicKey: 'AA'.repeat(33),
        challenge: 'chal-1',
        // Absent `purpose` — the legacy shape the CHECK maps to 'signin' once.
        expiresAt: FUTURE,
        used: false,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    authcodes: [
      {
        _id: oid('68a8000000000000000000a2'),
        codeHash: 'ch-1',
        userId: oid(USER_A),
        appId: oid(APPLICATION),
        redirectUri: 'https://commons.oxy.so/cb',
        codeChallenge: 'cc-1',
        codeChallengeMethod: 'S256',
        scopes: ['user:read'],
        deviceId: 'dev-1',
        expiresAt: FUTURE,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    authsessions: [
      {
        _id: oid('68a8000000000000000000a3'),
        sessionToken: 'st-1',
        authorizeCode: 'ac-1',
        boundOrigin: 'https://mention.earth',
        originVerified: true,
        applicationId: oid(APPLICATION),
        deviceId: 'dev-1',
        status: 'pending',
        // An EXPLICIT null, not an absent field, and the distinction is the
        // whole point: `distinct('deniedReason')` returns `[]` when no document
        // carries the field at all, so only an explicit null puts a `null` in
        // front of the enum audit. `auth_sessions_denied_reason_check` ACCEPTS
        // it (`null in (…)` is NULL, and a CHECK is satisfied by anything that
        // is not FALSE) and the column's own doc comment says an ordinary
        // cancel is "'declined' or ABSENT" — so a run over these fixtures must
        // stay clean. It did not before the audit's null handling was fixed.
        deniedReason: null,
        purpose: 'oauth_authorization',
        oauth: {
          redirectUri: 'https://commons.oxy.so/cb',
          codeChallenge: 'cc-2',
          codeChallengeMethod: 'S256',
          scopes: ['user:read'],
          subjectAccountId: oid(ORG),
        },
        expiresAt: FUTURE,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    devicepairingsessions: [
      {
        _id: oid('68a8000000000000000000a4'),
        pairingId: 'pair-1',
        newDeviceEphemeralPublicKey: 'EE'.repeat(33),
        status: 'pending',
        expiresAt: FUTURE,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    webauthnchallenges: [
      {
        _id: oid('68a8000000000000000000a5'),
        challenge: 'wc-1',
        type: 'registration',
        userId: oid(USER_A),
        expiresAt: FUTURE,
        used: false,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    webauthncredentials: [
      {
        _id: oid('68a8000000000000000000a6'),
        userId: oid(USER_A),
        credentialID: 'cred-1',
        credentialPublicKey: Buffer.from([1, 2, 3, 4, 250]),
        counter: 5,
        transports: ['internal', 'hybrid'],
        deviceType: 'multiDevice',
        backedUp: true,
        userVerified: true,
        name: 'Passkey',
        createdAt: T0,
        lastUsedAt: T1,
      },
    ],
    identitybackups: [
      {
        _id: oid('68a8000000000000000000a7'),
        userId: oid(USER_A),
        lookupIdHash: 'lh-1',
        publicKeyHint: 'AA',
        ciphertext: 'ct',
        nonce: 'nn',
        algorithm: 'xchacha20',
        kdfInfo: 'argon2id',
        version: 1,
        // A STRING timestamp in Mongo, kept verbatim as text.
        createdAt: '2026-01-02T03:04:05.000Z',
        updatedAt: T0,
      },
    ],
    domainverifications: [
      {
        _id: oid('68a8000000000000000000a8'),
        userId: oid(USER_A),
        domain: 'example.com',
        token: 'tok-1',
        status: 'pending',
        expiresAt: FUTURE,
        createdAt: T0,
      },
    ],
    civicnonces: [
      {
        _id: oid('68a8000000000000000000a9'),
        nonceHash: 'nh-1',
        purpose: 'attest',
        subjectUserId: oid(USER_A),
        expiresAt: FUTURE,
        createdAt: T0,
      },
    ],
    pushtokens: [
      {
        _id: oid('68a8000000000000000000aa'),
        userId: oid(USER_A),
        // Untrimmed on purpose: Mongoose trimmed via a schema SETTER, which has
        // no Postgres counterpart, so the transform must re-apply it.
        token: '  ExponentPushToken[abc]  ',
        platform: 'ios',
        deviceId: 'dev-1',
        applicationId: oid(APPLICATION),
        createdAt: T0,
        updatedAt: T0,
      },
    ],

    // ---- reputation, moderation, civic ------------------------------------
    reputationrules: [
      {
        _id: oid('68a9000000000000000000a1'),
        actionType: 'real_life_attested',
        points: 25,
        category: 'physical',
        description: 'Attested in person',
        cooldownInMinutes: 0,
        isEnabled: true,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    reputationtransactions: [
      {
        _id: oid(REPUTATION_TXN),
        userId: oid(USER_A),
        points: 25,
        actionType: 'real_life_attested',
        category: 'physical',
        applicationId: oid(APPLICATION),
        credentialId: oid(APP_CREDENTIAL),
        sourceActionId: 'src-1',
        sourceActionType: 'attestation',
        targetEntityId: USER_B,
        targetEntityType: 'user',
        status: 'active',
        reason: 'attested',
        metadata: { note: 'x' },
        createdByUserId: oid(USER_B),
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    reputationbalances: [
      {
        _id: oid('68a9000000000000000000a3'),
        userId: oid(USER_A),
        total: 25,
        positive: 25,
        negative: 0,
        // Every sub-name below is taken from the embedded schemas in
        // `models/ReputationBalance.ts`. Values are deliberately NON-DEFAULT so
        // a column mapped from the wrong path shows up as a mismatch rather
        // than as two zeroes agreeing.
        // `penalties` is a MAGNITUDE, never signed
        // (`reputation_balances_penalties_check`).
        breakdown: { content: 3, social: 4, trust: 5, moderation: 6, physical: 25, penalties: 2 },
        trustTier: 'trusted',
        influence: {
          defaultWeight: 0.15,
          reportWeight: 0.11,
          moderationWeight: 0.5,
          rankingFeedbackWeight: 0.17,
        },
        reliability: {
          accurateReports: 7,
          rejectedReports: 2,
          reportAccuracyScore: 0.78,
          abuseScore: 0.03,
        },
        personhood: { status: 'probable', score: 0.62 },
        contribution: { points: 25, tier: 'trusted' },
        conduct: { standing: 'watch', activeRisk: 1.5, activeStrikes: 1, nextExpiryAt: FUTURE },
        reporting: { reliability: 0.66, confidence: 0.4, confirmed: 5, rejected: 1, malicious: 0 },
        reviewing: {
          globalReliability: 0.5,
          categoryReliability: new Map([['spam', 0.8]]),
          languageReliability: new Map([['en', 0.9]]),
        },
        contextualInfluence: { reportPriorityWeight: 1, reviewSelectionWeight: 1, rankingWeight: 1 },
        lastTransactionId: oid(REPUTATION_TXN),
        recalculatedAt: T1,
        createdAt: T0,
        updatedAt: T1,
      },
    ],
    reputationdisputes: [
      {
        _id: oid('68a9000000000000000000a4'),
        transactionId: oid(REPUTATION_TXN),
        userId: oid(USER_A),
        reason: 'not me',
        status: 'open',
        evidence: ['https://example.com/e'],
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    reporterreputationprofiles: [
      {
        _id: oid('68a9000000000000000000a5'),
        userId: oid(USER_A),
        confirmed: 2,
        rejected: 1,
        duplicate: 0,
        malicious: 0,
        confirmedByFamily: new Map([['spam', 2]]),
        rejectedByFamily: new Map([['spam', 1]]),
        reliability: 0.66,
        confidence: 0.5,
        lastOutcomeAt: T1,
        createdAt: T0,
        updatedAt: T1,
      },
    ],
    reviewerreputationprofiles: [
      {
        _id: oid('68a9000000000000000000a6'),
        userId: oid(USER_A),
        status: 'active',
        agreements: 3,
        disagreements: 1,
        goldPassed: 2,
        goldFailed: 0,
        overturned: 0,
        globalReliability: 0.75,
        categoryReliability: new Map([['spam', 0.8]]),
        languageReliability: new Map([['en', 0.9]]),
        unlockedCategories: ['spam'],
        languages: ['en'],
        seedWeight: 0,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    moderationpolicies: [
      {
        _id: oid(MODERATION_POLICY),
        policyVersion: 'oxy-conduct-1',
        status: 'active',
        conductFamilies: ['spam', 'harassment'],
        repetitionMultipliers: [1, 1.5, 2],
        repetitionWindowDays: 90,
        multiFindingSecondaryShare: 0.5,
        multiFindingCap: 2,
        provisionalEffectsAllowed: false,
        severityRules: [
          { severity: 'low', points: -1, riskPoints: 1, riskExpiryDays: 30 },
          { severity: 'high', points: -10, riskPoints: 10, riskExpiryDays: 180 },
        ],
        standingThresholds: [
          { standing: 'good', minRisk: 0 },
          { standing: 'watch', minRisk: 5 },
        ],
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    applicationmoderationtrusts: [
      {
        _id: oid('68a9000000000000000000a8'),
        applicationId: oid(APPLICATION),
        standing: 'trusted',
        evidenceIntegrity: 0.9,
        identityBindingReliability: 0.8,
        decisionOverturnRate: 0.05,
        policyQuality: 0.7,
        globalReputationEffectsAllowed: true,
        reviewedByUserId: oid(USER_A),
        reviewedAt: T1,
        createdAt: T0,
        updatedAt: T1,
      },
    ],
    identitybindings: [
      {
        _id: oid(IDENTITY_BINDING),
        applicationId: oid(APPLICATION),
        userId: oid(USER_A),
        localPrincipalId: 'principal-1',
        bindingType: 'oauth_grant',
        status: 'active',
        verifiedAt: T0,
        credentialId: oid(APP_CREDENTIAL),
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    conductstrikes: [
      {
        _id: oid(CONDUCT_STRIKE),
        userId: oid(USER_A),
        incidentId: 'inc-1',
        decisionId: 'dec-1',
        decisionRevision: 1,
        applicationId: oid(APPLICATION),
        effectType: 'conduct_penalty',
        severity: 'low',
        riskPoints: 1,
        family: 'spam',
        status: 'active',
        expiresAt: FUTURE,
        policyVersion: 'oxy-conduct-1',
        transactionId: oid(REPUTATION_TXN),
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    moderationeffects: [
      {
        _id: oid('68a9000000000000000000ab'),
        eventId: 'evt-m1',
        incidentId: 'inc-1',
        caseId: 'case-1',
        decisionId: 'dec-1',
        decisionRevision: 1,
        principalId: oid(USER_A),
        bindingId: oid(IDENTITY_BINDING),
        applicationId: oid(APPLICATION),
        credentialId: oid(APP_CREDENTIAL),
        effectType: 'conduct_penalty',
        status: 'applied',
        points: -1,
        activeRisk: 1,
        severity: 'low',
        family: 'spam',
        repetitionMultiplier: 1,
        multiFindingMultiplier: 1,
        idempotencyKey: 'idem-1',
        transactionId: oid(REPUTATION_TXN),
        strikeId: oid(CONDUCT_STRIKE),
        policyVersions: {
          universal: 'universal-1',
          application: 'app-1',
          oxyConduct: 'oxy-conduct-1',
        },
        proofHash: 'p'.repeat(64),
        appliedAt: T0,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    personhoodstatuses: [
      {
        _id: oid('68aa000000000000000000a1'),
        userId: oid(USER_A),
        score: 0.7,
        isRealPerson: true,
        vouchCount: 2,
        realLifeCount: 1,
        biometricBound: true,
        sybilPenalty: 0,
        breakdown: {
          vouchSignal: 0.5,
          realLifeSignal: 0.35,
          biometricSignal: 0.15,
          evidence: 0.7,
          sybilPenalty: 0,
          seed: false,
        },
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    signedrecords: [
      {
        _id: oid(SIGNED_RECORD),
        subjectDid: `did:web:oxy.so:u:${USER_A}`,
        userId: oid(USER_A),
        type: 'personhood_vouch',
        envelope: { version: 2, seq: 1, record: { subject: USER_A }, signature: 'sig' },
        publicKey: 'AA'.repeat(33),
        verified: true,
        seq: 1,
        recordId: RECORD_ID,
        nsid: 'app.oxy.vouch',
        rkey: 'self',
        createdAt: T0,
      },
    ],
    personhoodvouches: [
      {
        _id: oid('68aa000000000000000000a3'),
        voucherUserId: oid(USER_B),
        subjectUserId: oid(USER_A),
        stakeAmount: 5,
        recordId: RECORD_ID,
        status: 'active',
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    repoheads: [
      {
        _id: oid('68aa000000000000000000a4'),
        userId: oid(USER_A),
        subjectDid: `did:web:oxy.so:u:${USER_A}`,
        seq: 1,
        headRecordId: RECORD_ID,
        recordCount: 1,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    nodeingestwitnesses: [
      {
        _id: oid('68aa000000000000000000a5'),
        userId: oid(USER_A),
        recordId: RECORD_ID,
        witnessSignature: 'ws-1',
        // Epoch milliseconds in Mongo, `timestamptz` in Postgres.
        ingestedAt: T0.getTime(),
        createdAt: T0,
      },
    ],
    validationrequests: [
      {
        _id: oid(VALIDATION_REQUEST),
        subjectUserId: oid(USER_A),
        actionType: 'real_life_attested',
        applicationId: oid(APPLICATION),
        sourceActionId: 'src-v1',
        payload: { subject: USER_A },
        payloadHash: 'h'.repeat(64),
        status: 'pending',
        // `threshold >= quorum` — the winning side needs at least a quorum's
        // worth of agreement.
        quorum: 3,
        threshold: 3,
        highValue: false,
        rngSeed: 'seed-1',
        candidateSnapshot: [{ userId: USER_B, weight: 1 }],
        selectedValidatorIds: [oid(USER_B), oid(ORG)],
        expiresAt: FUTURE,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    validationvotes: [
      {
        _id: oid('68aa000000000000000000a7'),
        requestId: oid(VALIDATION_REQUEST),
        validatorUserId: oid(USER_B),
        verdict: 'valid',
        envelope: { version: 2, verdict: 'valid' },
        publicKey: 'BB'.repeat(33),
        recordId: RECORD_ID,
        stakeWeight: 1,
        createdAt: T0,
      },
    ],
    validatoraffinities: [
      {
        _id: oid('68aa000000000000000000a8'),
        // Canonical pair order is enforced by a CHECK.
        validatorA: oid(ORG),
        validatorB: oid(USER_B),
        coVoteCount: 2,
        lastCoVoteAt: T1,
      },
    ],
    verifiablecredentials: [
      {
        _id: oid('68aa000000000000000000a9'),
        holderUserId: oid(USER_A),
        holderDid: `did:web:oxy.so:u:${USER_A}`,
        issuerUserId: oid(ORG),
        issuerDid: `did:web:oxy.so:u:${ORG}`,
        types: ['MembershipCredential'],
        claims: { role: 'member' },
        recordId: RECORD_ID,
        status: 'active',
        issuedAt: T0,
        expiresAt: FUTURE,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    transparencycheckpoints: [
      {
        _id: oid(TRANSPARENCY_CHECKPOINT),
        index: 1,
        // Epoch milliseconds in Mongo.
        periodEnd: T1.getTime(),
        treeSize: 1,
        root: 'r'.repeat(64),
        prevCheckpointHash: null,
        anchors: [
          // `anchoredAt` is a NUMBER (epoch ms) in Mongo, like `periodEnd`.
          { network: 'bitcoin', txid: 'tx-1', confirmations: 6, anchoredAt: T1.getTime() },
        ],
        signatures: [
          { publicKey: 'AA'.repeat(33), alg: 'ES256K-DER-SHA256', signature: 'sig-1' },
        ],
        snapshot: [
          { subjectDid: `did:web:oxy.so:u:${USER_A}`, seq: 1, headRecordId: RECORD_ID },
        ],
        createdAt: T0,
        updatedAt: T1,
      },
    ],
    securityactivities: [
      {
        _id: oid('68aa000000000000000000ab'),
        userId: oid(USER_A),
        eventType: 'sign_in',
        eventDescription: 'Signed in',
        severity: 'low',
        metadata: { method: 'passkey' },
        userAgent: 'Mozilla/5.0',
        deviceId: 'dev-1',
        timestamp: T1,
        createdAt: T0,
        updatedAt: T1,
      },
    ],
  };
}

/**
 * Documents the Postgres schema must REFUSE — and refuse by NAMING them.
 *
 * Each is a real production hazard, not an invented one:
 *
 * - `applications.status: 'restricted'` — the confirmed case. Mongoose never ran
 *   `runValidators`, so a value outside its own enum reached the database.
 * - two `labels` differing only by case — legal in Mongo, a collision under the
 *   `lower(name)` unique index Postgres now has.
 * - `files.ownerUserId: '__something_else__'` — a fourth system-owner sentinel
 *   the schema does not declare.
 * - `follows.followType: 'hashtag'` — an edge `user_follows` cannot represent.
 * - `authsessions.deniedReason: 'bogus'` — a value OUTSIDE
 *   `COMMONS_DENY_REASONS`, which the CHECK genuinely refuses. It sits next to
 *   the explicit `deniedReason: null` in {@link cleanFixtures} on purpose: the
 *   pair is what pins the difference between a NULL (accepted — a CHECK is
 *   satisfied by anything that is not FALSE) and an out-of-set value
 *   (rejected). An audit that cannot tell those apart is the false positive
 *   that blocked this migration.
 *
 * They are returned separately because a single fixture set holding both would
 * make "the clean run succeeded" untestable.
 */
export function dirtyFixtures(): FixtureSet {
  return {
    authsessions: [
      {
        _id: oid('68ab000000000000000000a6'),
        sessionToken: 'st-bogus',
        deviceId: 'dev-bogus',
        status: 'cancelled',
        purpose: 'device_sign_in',
        // NOT in COMMONS_DENY_REASONS. `null in (…)` is NULL and passes; THIS
        // evaluates to FALSE and the CHECK refuses the row.
        deniedReason: 'bogus',
        expiresAt: FUTURE,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    applications: [
      {
        _id: oid('68ab000000000000000000a1'),
        name: 'Rogue',
        // NOT in APPLICATION_STATUSES. A Postgres CHECK refuses it.
        status: 'restricted',
        type: 'third_party',
        ownerAccountId: oid(ORG),
        createdByUserId: oid(USER_A),
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    labels: [
      { _id: oid('68ab000000000000000000a2'), userId: oid(USER_A), name: 'Work', color: '#1', order: 0, createdAt: T0, updatedAt: T0 },
      { _id: oid('68ab000000000000000000a3'), userId: oid(USER_A), name: 'WORK', color: '#2', order: 1, createdAt: T0, updatedAt: T0 },
    ],
    files: [
      {
        _id: oid('68ab000000000000000000a4'),
        sha256: '9'.repeat(64),
        size: 1,
        mime: 'text/plain',
        ext: 'txt',
        ownerUserId: '__something_else__',
        status: 'active',
        visibility: 'private',
        purpose: 'user',
        storageKey: 'assets/x',
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    follows: [
      {
        _id: oid('68ab000000000000000000a5'),
        followerUserId: oid(USER_A),
        followedId: oid('68ab0000000000000000ffff'),
        followType: 'hashtag',
        createdAt: T0,
        updatedAt: T0,
      },
    ],
  };
}

/**
 * Documents the schema would refuse but the migration has a DECIDED answer for.
 *
 * A third class, distinct from both sets above, and the distinction is the
 * point:
 *
 * - {@link cleanFixtures} — the schema accepts them as they are.
 * - {@link dirtyFixtures} — the schema refuses them and the copy is REFUSED,
 *   loudly, because nobody has decided what should happen.
 * - these — the schema would refuse them, and `db/backfill/resolutions.ts`
 *   says exactly what the migration does instead. They are COPIED, with a
 *   recorded, reported change.
 *
 * Built on top of the clean set rather than standing alone, so every foreign
 * key resolves and the copy exercises the real path — and so each resolvable
 * document sits beside a healthy CONTROL of the same shape (a good card, a
 * request holding its own `sourceActionId`). Without the control, a rule
 * widened to fire on everything would look identical to a correct one.
 */
export function resolvableFixtures(): FixtureSet {
  const fixtures = cleanFixtures();
  const messages = fixtures.messages ?? [];
  const template = messages[0] ?? {};

  return {
    ...fixtures,
    messages: [
      ...messages,
      {
        // FINDING 1, the production shape: something assigned card METADATA to
        // the type field. `card.type` is an OBJECT where the column is `text`
        // constrained to five values, so no client can render this card — but
        // the message body beside it is perfectly intact.
        ...template,
        _id: oid(MESSAGE_CORRUPT_CARD),
        messageId: '<corrupt-card@example.com>',
        subject: 'Your trip is confirmed',
        text: 'The body of this message is intact and must survive.',
        card: {
          type: { confidence: 0, extractedAt: '2026-03-07T09:12:44.000Z' },
          data: { total: 42 },
          confidence: 0,
          extractedAt: T1,
        },
      },
      {
        // The CONTROL. A card whose type IS one of the five: every one of its
        // four columns must arrive intact. This is what makes the rule's
        // narrowness testable — widen the predicate and this row goes red.
        ...template,
        _id: oid(MESSAGE_VALID_CARD),
        messageId: '<valid-card@example.com>',
        subject: 'Your receipt',
        card: { type: 'bill', data: { total: 7 }, confidence: 0.75, extractedAt: T1 },
      },
    ],
    validationrequests: [
      ...(fixtures.validationrequests ?? []),
      // FINDING 2, group one: three requests holding ONE `sourceActionId` open.
      // `createdAt` orders them, and the newest survives.
      duplicateRequest(DUP_REQUEST_OLDEST, DUPLICATE_ACTION_KEY, 'pending', T0),
      // `quorum_met` is open too — the partial index covers BOTH open statuses,
      // so a rule that only looked at `pending` would leave a collision behind.
      duplicateRequest(DUP_REQUEST_MIDDLE, DUPLICATE_ACTION_KEY, 'quorum_met', T1),
      duplicateRequest(DUP_REQUEST_NEWEST, DUPLICATE_ACTION_KEY, 'pending', FUTURE),
      // Group two: NO `createdAt` at all, so the only thing that can order them
      // is the ObjectId's own embedded timestamp.
      duplicateRequest(DUP_UNTIMED_OLDER, DUPLICATE_ACTION_KEY_UNTIMED, 'pending', null),
      duplicateRequest(DUP_UNTIMED_NEWER, DUPLICATE_ACTION_KEY_UNTIMED, 'pending', null),
      // Two CLOSED rows on group one's key. They share `DUPLICATE_ACTION_KEY`
      // with the three open ones above and are nonetheless legal, because the
      // unique index is partial on the open statuses. They must not be reported
      // and must not be demoted — see their declarations.
      duplicateRequest(DUP_CLOSED_EXPIRED, DUPLICATE_ACTION_KEY, 'expired', T0),
      duplicateRequest(DUP_CLOSED_RESOLVED, DUPLICATE_ACTION_KEY, 'validated', T1, 'validated'),
    ],
  };
}

/**
 * Documents whose FOREIGN KEYS dangle — the shape that stopped the first
 * production run.
 *
 * A fourth class, and the one no audit could see until
 * `referentialIntegrity.ts` existed: every document below is perfectly valid on
 * its own (right enums, no collisions, complete fields) and names a parent that
 * does not exist. Mongo enforced no foreign key, so an account deleted years ago
 * leaves its rows behind; Postgres answers `23503`.
 *
 * Built on the clean set, so the ONLY dangling references are the three injected
 * here and every other relation is a live control. Three, because the schema's
 * own `ON DELETE` makes them three genuinely different questions — see
 * `OrphanResolvability`:
 *
 * | document | relation | column | ON DELETE |
 * |---|---|---|---|
 * | {@link ORPHAN_BUNDLE} | `bundles.user_id -> users.id` | NOT NULL | cascade |
 * | {@link ORPHAN_REMINDER} | `reminders.related_message_id -> messages.id` | NULLABLE | set null |
 * | {@link ORPHAN_PUSH_TOKEN} | `push_tokens.application_id -> applications.id` | NULLABLE | cascade |
 *
 * Each sits beside a healthy sibling of the SAME shape (the clean set's own
 * bundle, reminder and push token), so a check that reported every row of a
 * relation rather than the dangling one would be caught here rather than in
 * production.
 */
export function orphanFixtures(): FixtureSet {
  const fixtures = cleanFixtures();
  return {
    ...fixtures,
    bundles: [
      ...(fixtures.bundles ?? []),
      {
        // THE PRODUCTION SHAPE, verbatim: a bundle whose owner is gone.
        _id: oid(ORPHAN_BUNDLE),
        userId: oid(DELETED_USER),
        name: 'Orphaned',
        icon: 'folder-outline',
        color: '#5F6368',
        matchLabels: [],
        enabled: true,
        collapsed: true,
        order: 1,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    reminders: [
      ...(fixtures.reminders ?? []),
      {
        _id: oid(ORPHAN_REMINDER),
        userId: oid(USER_A),
        text: 'Reply to a message that no longer exists',
        remindAt: FUTURE,
        completed: false,
        pinned: false,
        relatedMessageId: oid(DELETED_MESSAGE),
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    pushtokens: [
      ...(fixtures.pushtokens ?? []),
      {
        _id: oid(ORPHAN_PUSH_TOKEN),
        userId: oid(USER_A),
        token: 'ExponentPushToken[orphan]',
        platform: 'android',
        deviceId: 'dev-2',
        applicationId: oid(DELETED_APPLICATION),
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    topics: [
      ...(fixtures.topics ?? []),
      // A HEALTHY self-reference that points FORWARD in `_id` order: the child
      // sorts before the parent, so at the instant the child's row is built the
      // parent has not been read yet. `topics.parent_topic_id` is one of the
      // seven self-referencing columns the copy defers to a second pass for
      // exactly this reason. A check that decided orphanhood at emit time would
      // report this — and reporting a reference that resolves is the failure
      // that gets a gate switched off.
      {
        _id: oid(FORWARD_CHILD_TOPIC),
        name: 'mobile',
        slug: 'mobile',
        displayName: 'Mobile',
        type: 'category',
        source: 'seed',
        aliases: [],
        parentTopicId: oid(FORWARD_PARENT_TOPIC),
        isActive: true,
        createdAt: T0,
        updatedAt: T0,
      },
      {
        _id: oid(FORWARD_PARENT_TOPIC),
        name: 'devices',
        slug: 'devices',
        displayName: 'Devices',
        type: 'category',
        source: 'seed',
        aliases: [],
        isActive: true,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
  };
}

/**
 * Documents whose dangling foreign key a DOCUMENTED RULE answers — the
 * production shape of all 503 orphaned rows, in miniature.
 *
 * Distinct from {@link orphanFixtures}, which holds the two relations nothing
 * answers and therefore still block. This set must COPY SUCCESSFULLY: the point
 * is to read back what the rules actually wrote.
 *
 * Every orphan sits beside a CONTROL of the same shape whose parent is live, and
 * the controls are what the mutation test breaks:
 *
 * | document | relation | ON DELETE | rule |
 * |---|---|---|---|
 * | {@link RESOLVED_ORPHAN_BUNDLE} | `bundles.user_id` | NOT NULL, cascade | drop the row |
 * | {@link RESOLVED_ORPHAN_FOLLOW} | `user_follows.follower_id` | NOT NULL, cascade | drop the row |
 * | {@link RESOLVED_ORPHAN_NOTIFICATION} | `notifications.actor_id` | NOT NULL, cascade | drop the row |
 * | {@link RESOLVED_ORPHAN_DEVICE_SESSION} | `device_sessions.active_account_id` | NULLABLE, set null | write NULL, KEEP the row |
 * | …its first `accounts` entry | `device_session_accounts.account_id` | NOT NULL, cascade | drop the row |
 * | {@link RESOLVED_ORPHAN_FILE} | `files.owner_user_id` | **NULLABLE**, cascade | drop the row |
 *
 * The device session and its entry are one document on purpose: it is the case
 * the decision itself turns on. The account ENTRY for the absent parent goes and
 * the DEVICE survives holding no active account — while its second entry, whose
 * account is live, is untouched.
 *
 * The FILE is the one that can go wrong quietly. Its column is NULLABLE, so a
 * widened predicate would not fail loudly the way it does on the nine NOT NULL
 * relations — it would silently destroy a file that has a live owner. So it sits
 * beside two controls the clean set already provides: {@link FILE_USER}, owned
 * by a live account, and the two SENTINEL-owned files, whose `ownerUserId` is a
 * `__namespace__` string that is not an account at all and must never be read as
 * an absent one. It carries no `links` or `variants`, because a dropped file
 * WITH children is a cascade this fixture set deliberately does not answer —
 * `orphanFileWithChildrenFixtures` is where that is exercised.
 */
export function orphanResolutionFixtures(): FixtureSet {
  const fixtures = cleanFixtures();
  return {
    ...fixtures,
    files: [
      ...(fixtures.files ?? []),
      {
        _id: oid(RESOLVED_ORPHAN_FILE),
        sha256: 'e'.repeat(64),
        size: 4096,
        mime: 'image/png',
        ext: 'png',
        // A real account id, and the account is gone.
        ownerUserId: DELETED_USER,
        status: 'active',
        visibility: 'private',
        purpose: 'user',
        // Content-addressed, and it embeds the upload's year/month — which is
        // why it is CARRIED into the report rather than re-derived later.
        storageKey: `content/2026/03/ee/${'e'.repeat(64)}.png`,
        originalName: 'orphan.png',
        createdAt: T0,
        updatedAt: T0,
      },
      {
        // THE CONTROL, and it is deliberately CHILDLESS. `FILE_USER` is also
        // owned by a live account, but it has links, variants and a message
        // attachment — so a rule that wrongly dropped it would be caught by the
        // cascade before any assertion about it ran, and "the rule spared it"
        // would never actually be tested. This one has nothing pointing at it,
        // so the only thing that can keep it is the predicate being narrow.
        _id: oid(LIVE_OWNER_FILE),
        sha256: 'f'.repeat(64),
        size: 1024,
        mime: 'image/png',
        ext: 'png',
        ownerUserId: USER_B,
        status: 'active',
        visibility: 'private',
        purpose: 'user',
        storageKey: `content/2026/03/ff/${'f'.repeat(64)}.png`,
        originalName: 'kept.png',
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    bundles: [
      ...(fixtures.bundles ?? []),
      {
        _id: oid(RESOLVED_ORPHAN_BUNDLE),
        userId: oid(DELETED_USER),
        name: 'Orphaned',
        icon: 'folder-outline',
        color: '#5F6368',
        matchLabels: [],
        enabled: true,
        collapsed: true,
        order: 1,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    follows: [
      ...(fixtures.follows ?? []),
      {
        _id: oid(RESOLVED_ORPHAN_FOLLOW),
        followerUserId: oid(DELETED_USER),
        followedId: oid(USER_B),
        followType: 'user',
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    notifications: [
      ...(fixtures.notifications ?? []),
      {
        _id: oid(RESOLVED_ORPHAN_NOTIFICATION),
        recipientId: oid(USER_A),
        actorId: oid(DELETED_USER),
        type: 'follow',
        entityId: oid(DELETED_USER),
        entityType: 'profile',
        read: false,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    devicesessions: [
      ...(fixtures.devicesessions ?? []),
      {
        _id: oid(RESOLVED_ORPHAN_DEVICE_SESSION),
        deviceId: 'dev-orphan',
        accounts: [
          // Dropped: the account is gone, so the entry addresses nothing.
          { accountId: oid(DELETED_USER), sessionId: 'sess-gone', authuser: 0, addedAt: T0 },
          // KEPT — the control that proves the drop is per ENTRY, not per
          // device. A rule widened to the document would take this with it.
          { accountId: oid(USER_B), sessionId: 'sess-live', authuser: 1, addedAt: T1 },
        ],
        activeAccountId: oid(DELETED_USER),
        secretHash: 'b2'.repeat(32),
        revision: 1,
        createdAt: T0,
        updatedAt: T1,
      },
    ],
  };
}

/** A bundle whose owner is gone. DROPPED — NOT NULL, ON DELETE CASCADE. */
export const RESOLVED_ORPHAN_BUNDLE = '68ae000000000000000000a1';
/** A follow whose FOLLOWER is gone. DROPPED, and its followed account is live. */
export const RESOLVED_ORPHAN_FOLLOW = '68ae000000000000000000a2';
/** A notification whose ACTOR is gone. DROPPED, and its recipient is live. */
export const RESOLVED_ORPHAN_NOTIFICATION = '68ae000000000000000000a3';
/**
 * A device session whose active account is gone.
 *
 * KEPT with `active_account_id` NULL, while the `accounts` entry naming that
 * same absent account is dropped and the entry beside it survives.
 */
export const RESOLVED_ORPHAN_DEVICE_SESSION = '68ae000000000000000000a4';

/**
 * A file whose owning account is gone. DROPPED — NULLABLE, ON DELETE CASCADE.
 *
 * Its `sha256` and `storage_key` are what the run report must carry beside the
 * id: they are the only remaining handle on the S3 object the dropped row was
 * the last record of.
 */
export const RESOLVED_ORPHAN_FILE = '68ae000000000000000000a6';

/**
 * A file with a LIVE owner and nothing referencing it.
 *
 * The control that is not shadowed by anything else: no link, no variant, no
 * attachment, so if the rule wrongly drops it the ONLY thing that notices is the
 * assertion that it is still there.
 */
export const LIVE_OWNER_FILE = '68ae000000000000000000a7';

/** That file's content hash — named once, so the report can be asserted on it. */
export const RESOLVED_ORPHAN_FILE_SHA256 = 'e'.repeat(64);
/** …and its content-addressed key, which no later run could re-derive. */
export const RESOLVED_ORPHAN_FILE_STORAGE_KEY = `content/2026/03/ee/${'e'.repeat(64)}.png`;

/**
 * The same orphaned file, but WITH the children a real one may have.
 *
 * `files` is the first table a resolution drops from that anything else
 * references: `file_links.file_id` and `file_variants.file_id` cascade from it,
 * and `message_attachments.file_id` declares ON DELETE **no action** — the
 * schema's way of saying a stored message's attachment must never be silently
 * emptied. So this set pins what happens: the audit reports those rows as
 * orphans of the drop and BLOCKS, rather than letting a second `23503` arrive at
 * copy time. Nobody has decided what a dropped file's links and variants become,
 * and this migration does not decide it either.
 */
export function orphanFileWithChildrenFixtures(): FixtureSet {
  const fixtures = orphanResolutionFixtures();
  return {
    ...fixtures,
    files: (fixtures.files ?? []).map((file) =>
      String(file._id) === RESOLVED_ORPHAN_FILE
        ? {
            ...file,
            links: [
              {
                app: 'mention',
                entityType: 'post',
                entityId: 'post-orphan',
                createdBy: USER_A,
                createdAt: T0,
              },
            ],
            variants: [
              { type: 'thumbnail', key: 'assets/e-thumb', width: 32, height: 32, size: 128 },
            ],
          }
        : file
    ),
  };
}

/** A bundle whose `userId` names an account the source no longer holds. */
export const ORPHAN_BUNDLE = '68ad000000000000000000b1';
/** A reminder pointing at a message that is gone. NULLABLE, ON DELETE SET NULL. */
export const ORPHAN_REMINDER = '68ad000000000000000000b2';
/** A push token registered by an application that is gone. NULLABLE, ON DELETE cascade. */
export const ORPHAN_PUSH_TOKEN = '68ad000000000000000000b3';

/** The account id no `users` document carries. */
export const DELETED_USER = '68ad0000000000000000ffa1';
/** The message id no `messages` document carries. */
export const DELETED_MESSAGE = '68ad0000000000000000ffa2';
/** The application id no `applications` document carries. */
export const DELETED_APPLICATION = '68ad0000000000000000ffa3';

/** A topic naming a parent that sorts AFTER it — a healthy forward reference. */
export const FORWARD_CHILD_TOPIC = '68ad000000000000000000c1';
/** That parent. Streamed second, so the child's reference resolves only at the end. */
export const FORWARD_PARENT_TOPIC = '68ad000000000000000000c2';

/**
 * One member of a duplicate-open group.
 *
 * `createdAt: null` means the field is ABSENT from the document, not null —
 * which is what forces the ObjectId-timestamp fallback. Mongoose would normally
 * write a timestamp, so this is the shape of a document that predates it.
 */
function duplicateRequest(
  documentId: string,
  sourceActionId: string,
  status: string,
  createdAt: Date | null,
  outcome: string | null = null
): FixtureDocument {
  return {
    _id: oid(documentId),
    subjectUserId: oid(USER_A),
    actionType: 'personhood_audit',
    sourceActionId,
    payload: { subject: USER_A },
    payloadHash: 'd'.repeat(64),
    status,
    quorum: 3,
    threshold: 3,
    highValue: false,
    rngSeed: `seed-${documentId}`,
    candidateSnapshot: [{ userId: USER_B, weight: 1 }],
    selectedValidatorIds: [oid(USER_B)],
    expiresAt: FUTURE,
    // `validation_requests_terminal_check` ties the two together: a verdict
    // status must carry the matching outcome, and every other status must carry
    // none. Passing them separately would let a fixture state a row the schema
    // refuses, which fails as a confusing INSERT error rather than as a test.
    ...(outcome === null ? {} : { outcome }),
    ...(createdAt === null ? {} : { createdAt, updatedAt: createdAt }),
  };
}
