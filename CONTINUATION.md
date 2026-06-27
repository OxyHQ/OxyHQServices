# CONTINUATION HANDOFF — Commons "Oxy ID" civic identity platform (OxyHQServices)

> **You are an AI coding agent (Claude Code / Codex / Gemini) resuming this work.**
> This file IS your prompt. Read it fully, then read the repo's `AGENTS.md` (its rules
> are binding). Work **agent-first** (delegate; don't code in the main thread),
> **one owner per package per phase**, and follow the ship/verify conventions below.
> Respond in the user's language (Spanish or English).

---

## 0. TL;DR of where things stand

A multi-phase build turning **Commons by Oxy** (native-only identity vault,
`packages/commons`) into a citizen-identity / "Oxy ID" app with verifiable,
crypto-owned reputation, real-life + jury attestations, proof-of-personhood, and
verifiable credentials. The civic **engine lives in `oxy-api`**
(`packages/api/src/services/civic/` + `routes/civic.ts`); ownership comes from
**cryptography** (per-user hash-chained signed records), Commons is the UI face.

**Shipped to `main` and deployed (AWS oxy-api + Cloudflare frontends), CI green:**
F0, F1, F2, F3, F4, the DNI→"Oxy ID" rename, the Commons nav restructure, and the
Reputation screen redesign. **Only `F5` (user nodes / decentralization) remains.**

---

## 1. Roadmap status

| Phase | What | Status |
|---|---|---|
| F0 | Signed-record hash chain — envelope **v2** (`version,seq,prev,collection,rkey`), `RepoHead` O(1) head | ✅ shipped (37d11b69) |
| F1 | Oxy ID card + crypto-owned reputation (signed attestations) + offline-first | ✅ shipped (37d11b69) |
| F2 | Anti-gaming: real-life QR attestation (HIGH, 25pts) + random validator **jury** (MEDIUM, 8pts) | ✅ shipped (5dc710d4) |
| F3 | Proof-of-personhood: web-of-trust **vouches** + staking + sybil clustering + random audits (reuse F2 jury) + biometric | ✅ shipped (6780ad55) |
| F4 | **Verifiable Credentials** (issue / verify / revoke), signed, anchored on holder DID | ✅ shipped (2a279044) |
| — | Rename **DNI→"Oxy ID"** (clean cut, zero "dni" anywhere) + Commons nav (Home merged into **ID** tab, scan = Bloom **FAB** → fullScreenModal, **3 tabs**, active tab tint = text color) | ✅ shipped (6780ad55) |
| — | **Reputation screen redesign** (engine-room: standing hero + Skia composition donut + civic-duty CTA + signed activity ledger) | ✅ shipped (0a82e78e) |
| — | CI lint fix (pre-existing `require()` in DID tests) | ✅ shipped (9aaa3875) |
| **F5** | **User nodes (decentralization)** — node publishes signed, Oxy ingests; reads NEVER touch a node | ⛔ **NOT STARTED — next phase** |

Test baselines (per-package, correct runner): **core 623**, **api 997**, **commons 336**, **contracts 81**.

---

## 2. ⚠️ Live hazards — READ BEFORE TOUCHING THE REPO

1. **A SECOND Claude session is concurrently editing `packages/api`.** As of this
   handoff there are **uncommitted** changes in the working tree that are NOT part
   of the civic work — a federation own-domain fix:
   `packages/api/src/routes/users.ts`, `packages/api/src/services/federation.service.ts`,
   their tests, and an untracked `packages/api/src/scripts/dedupe-own-domain-federated-users.ts`.
   **Do NOT commit, stash, or revert those — they belong to the other session.**
   Always **path-scope your `git add`** (e.g. `git add packages/commons`), never
   `git add -A`, and `git status` before committing. **Confirm sole ownership of
   `packages/api` before starting F5** (it is api-heavy and will collide).
2. **Branch discipline:** the deploy model is **push to `main`**. Before any commit,
   `git branch --show-current` MUST be `main`. (F3 once accidentally landed on a
   feature branch `fix/sec-batch-2-claude-1782394263` and had to be fast-forwarded
   to main — verify the branch every time.)
3. **Metro / Pixel dev build** is running for the user's physical device. See §6.

---

## 3. Architecture quick-reference

- **DID:** `did:web:api.oxy.so:u:<userId>` (account-anchored on `_id`; configurable
  via `DID_WEB_DOMAIN` env). Keypair = a verification method via `authMethods[]`.
  Crypto: secp256k1 (elliptic), alg `ES256K-DER-SHA256`.
- **Signed records (envelope v2):** `{version:2, type, subject, issuer, record,
  issuedAt, publicKey, alg, signature, seq, prev, collection, rkey}`. Signing input =
  `signedRecordSigningInput(env)` (shared client+server, in `@oxyhq/core`
  `crypto/canonicalJson.ts` / `signatureService.ts`); `recordId = sha256(signingInput)`.
  v1 still verifies (back-compat). Per-subject hash chain via `seq`/`prev`; `RepoHead`
  is the O(1) head pointer. `verifyEnvelope` branches: `issuer===subject` (self-issued)
  | `issuer===OXY_DID` (Oxy custodial key, `verifySecret`) | else `untrusted_issuer`.
- **API models** (`packages/api/src/models/`): `SignedRecord` (DB column **`nsid`** =
  envelope `collection`), `RepoHead`, `CivicNonce`, `ValidationRequest`,
  `ValidationVote`, `ValidatorAffinity`, `PersonhoodVouch`, `PersonhoodStatus`,
  `VerifiableCredential`, plus `User` (`isSeedVerifier`, `verifiedDomains`, `did` virtual).
- **API civic services** (`packages/api/src/services/civic/`): `attestation`,
  `publicCard`, `realLife`, `validator`, `slash`, `graphExclusion` (shared sock-puppet
  detection — Follow/Block 1-2 hops + shared device/IP), `sybil`, `personhood`,
  `personhoodAudit`, `credential`. Routes: `routes/civic.ts` (`/civic/*`). Constants:
  `utils/civic.constants.ts`, `utils/reputation.constants.ts`, `utils/personhoodDerive.ts`.
- **Reputation (Oxy Trust):** `reputation.service.ts` is the single award authority.
  **Users NEVER self-award** — they sign votes/attestations; a civic service decides
  quorum and calls `reputationService.award(...)` in-process (`emitAttestation:true`
  emits an Oxy-signed `reputation_attestation`). Action weights:
  `real_life_attested`(25,physical), `peer_validated`(8,trust),
  `validation_correct`(3)/`validation_incorrect`(-10),
  `personhood_vouched`(5)/`vouch_slashed`(-20). Trust tiers:
  restricted→new→trusted(≥100)→high_trust(≥500)→verified(`User.verified`, from personhood).
- **Personhood derive (pure):** `evidence = 0.50·vouchSignal + 0.35·realLifeSignal +
  0.15·biometricSignal`; `score = evidence·(1−sybilPenalty)`; `isRealPerson = score≥θ
  (0.6)` → sets `User.verified` → existing `deriveTrustTier` promotes to `verified`.
  `isSeedVerifier` (hand-picked) ⇒ score 1 (genesis). Biometric signal rides
  `real_life_attested` txns with `metadata.biometricOk===true`.
- **QR schemes (ALL `oxycommons://`)**: `card?did=…`, `attest?subject=…&ctx=…&nonce=…&exp=…`,
  `approve?…` (sign-in handoff). The old `oxydni://` is GONE (clean rename — there is
  zero "dni" anywhere; verify with `grep -riE 'dni|oxydni' packages/`).

---

## 4. SDK + Commons surface (already built)

- **`@oxyhq/core` civic mixin** (`packages/core/src/mixins/OxyServices.civic.ts`):
  `getPublicCard`, `getMyIdPayload`, `parseIdPayload`, `buildAttestQrPayload`,
  `parseAttestPayload`, `submitRealLifeAttestation`, `getValidatorInbox`,
  `submitValidationVote`, `denyValidation`, `vouchForPerson`, `withdrawVouch`,
  `getPersonhood`, `getMyPersonhood`, `issueCredential`, `listCredentials`,
  `listMyCredentials`, `verifyCredential`, `revokeCredential`. All signing goes through
  `_signMyCivicRecordV2` → `SignatureService.signRecordV2` (never hand-rolled).
  Reputation reads via `oxyServices.getReputationTransactions(userId, limit, offset)`
  (flat positional signature).
- **`@oxyhq/contracts`** (`src/civic.ts` + `src/identity.ts`): all civic wire types
  (publicCard, realLife, validation, personhood, credential schemas). **Internal
  packages declare `@oxyhq/contracts` as `workspace:*`** (NOT `^0.x`) so they resolve
  TS source, not stale published types. **Not published to npm yet** (current published
  is 0.3.0; the new civic types are local-only — fine because Commons consumes via
  workspace and the api Docker build builds contracts from source).
- **Commons nav** (`packages/commons/app/`): `(tabs)/` = `(id)` [default] · `(reputation)`
  · `(settings)` — **3 NativeTabs** (active `tintColor=colors.text`,
  `indicatorColor`/`rippleColor=colors.primarySubtle`, `backgroundColor=colors.card`,
  inactive `iconColor=colors.textSecondary`). Scan = Bloom `Fab` (`@oxyhq/bloom/fab`)
  on the ID landing → `app/(scan)/` declared `presentation:'fullScreenModal'` in the
  root Stack. ID landing = OxyID card + QR + hub. Settings → "Trust & verification" →
  Proof of personhood + Credentials. Reputation = redesigned engine-room screen
  (`components/reputation/*`, `hooks/useReputationActivity.ts`,
  `lib/civic/reputation-{standing,activity}.ts`). Attest/vouch/credential-issue flows
  are biometric-gated (`lib/biometricAuth`). Scan parsing: `lib/commons-signin/parse-scan.ts`.

---

## 5. Ship / verify / deploy conventions (FOLLOW EXACTLY)

1. **Per-package tests** use the package's own runner: `bun run --filter <pkg> test`
   (Jest for contracts/core/api/services/auth-sdk; the standalone `packages/auth` app
   is `bun test`). **NEVER blanket `bun test`** across the monorepo (false failures).
2. **`bun run build:all`** (turbo, expect 9/9). The ONLY allowed tsc noise is **2
   pre-existing `@oxyhq/services/src` errors** (`ConnectedAppsScreen.tsx` +
   `ManageAccountScreen.tsx`, NativeWind `contentContainerClassName`) — they do not
   break `build:all`. Anything else is real.
3. **`bun install --frozen-lockfile`** must be clean; commit `bun.lock` in the SAME
   commit as any `package.json` change.
4. **CI gate** = the **"CI/CD Pipeline"** workflow (jobs: API Tests [incl. `bun run lint`,
   0 errors required — warnings OK], API Build, Security Audit). `Deploy to AWS` +
   `Deploy Frontend to Cloudflare Pages` run separately and DO deploy even if CI is red,
   so always confirm CI green too (`gh run list --branch main --workflow "CI/CD Pipeline"`).
5. **Ship flow:** spawn **`test-build`** (runs the above) → it spawns **`git-ops`** →
   commit **directly on `main`** (CONFIRM branch first; path-scope the `git add` to your
   package, never `-A`, because of the concurrent api session) → `git push origin main`
   → deploy auto-triggers. **Verify deploy live** by polling the new endpoint until
   non-404 (see §6), then restart Metro `-c` for the device.
6. **Agent-first / fix-upstream:** delegate to `oxy-api`, `oxy-core`,
   `oxy-services` (owns `packages/commons` here), `test-build`, `git-ops`,
   `docs-keeper`. One owner per package per phase. Fix bugs at the source package.
7. **Quality rules (binding, from AGENTS.md):** no `as any` / `@ts-ignore` / `!` /
   silent `catch {}` / `console.log` / `var` / TODO. Backend writes never
   `new Model(req.body)` / never spread `req.body` — resolve owner ids via
   `getRequiredOxyUserId`, whitelist fields. `safeFetch` for user-supplied URLs (SSRF),
   `verifySecret` for secret compares, `createOxyCors` for CORS, unique rate-limit
   `prefix` per limiter, `userCache.invalidate(userId)` after user-state writes.

---

## 6. Device / ops command reference

```bash
# Deploy poll (replace the path; 404 → not deployed yet, 200 → live)
URL=https://api.oxy.so/civic/personhood/69b2d3df5d12f58c9800d651
for i in $(seq 1 18); do c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$URL"); \
  echo "$i $c"; [ "$c" != 404 ] && [ "$c" != 000 ] && break; sleep 30; done

# CI status
gh run list --branch main --workflow "CI/CD Pipeline" --limit 3
gh run view <id> --log-failed | grep -E '  error  '   # only ERRORS fail lint

# Metro restart (route-tree / new-route changes need -c). Pixel at 192.168.8.101:8081.
# Find + kill the metro pid on 8081, then relaunch from packages/commons:
P=$(ss -ltnp | grep ':8081' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2); kill "$P"
cd /home/nate/Oxy/OxyHQServices/packages/commons && \
  EXPO_NO_TELEMETRY=1 node /home/nate/Oxy/OxyHQServices/node_modules/.bin/expo \
  start --dev-client --port 8081 -c        # do NOT set CI=1 (it disables watch/Fast Refresh)

# ADB wireless reconnect after the phone locks / port rotates:
adb mdns services | grep _adb-tls-connect   # grab the live host:port, then:
adb connect 192.168.8.101:<port>
```

---

## 7. F5 — USER NODES (decentralization) — the next phase, detailed

**Invariant: reads NEVER touch a node.** All node I/O is background via `safeFetch`.
Node down = stale-but-instant, never slow. Reuses the F0 hash chain.

- **5a (one-way, Oxy→node):** node registration = a signed `type:'node'` record
  `{endpoint, nodePublicKey, mode}` via `POST /identity/records`. `models/UserNode.ts`
  (operational cache + cursors). `services/nodeRegistry.service.ts` (async liveness probe
  via `safeFetch ${endpoint}/.well-known/oxy-node.json`). DID doc announces
  `service: {id:#oxy-node, type:OxyPersonalDataNode, serviceEndpoint}`. Public log:
  `GET /identity/log/:userId?since=` + `GET /identity/head/:userId`. Transport: **pull
  (default, node paces)** or optional push (`services/nodeSync.service.ts`,
  fire-and-forget). Heavy media is NOT copied — a **signed manifest** (hash + CDN URL);
  the node pins on demand via `GET /blobs/:hash`.
- **5b (bidirectional, node→Oxy):** node exposes `/oxy/log` + `/oxy/head`.
  `POST /nodes/ingest/notify` (hint, no authority) → enqueue → worker `safeFetch`es the
  node log and **verifies every record** (`verifyEnvelope` + chain continuity + DID
  owner) before append. **Conflicts = LWW per `(collection,rkey)`** (higher `issuedAt`,
  tiebreak `recordId`); fork = keep both, head advances to higher-`issuedAt` branch.
  Recommend a single active `writeOrigin` per user. **Oxy counter-signs each ingested
  `recordId`** (immutable witness vs a stolen key rewriting history). `routes/nodes.ts`.
  **Everything async/background — never in the read path.**
- **5c (managed vault):** Oxy runs the same image with a custodial key
  (`controller:[OXY_DID]`); "Create your vault" button for non-technical users.
- **`packages/node`:** light Express (`better-sqlite3` log + on-disk blobs), minimal API
  (`/.well-known/oxy-node.json`, `/oxy/log`, `/oxy/head`, `/sync/push`, `/blobs/:hash`,
  `/records`), reuses `@oxyhq/core` `KeyManager`/`SignatureService` (a record signed on
  the node verifies in Oxy with no new code). Docker one-liner + Caddyfile TLS.
- **Data boundary:** on the node goes self-authored, signable-as-own facts (identity,
  profile, credentials, social graph as DIDs, own content namespaced
  `app.<x>.<y>/<rkey>`, media manifest). NOT derived/aggregated (feeds, indexes,
  reputation scores, notifications) — those are recomputed, not owned.
- **Sequence (mirror F2/F3/F4):** api first (sole-own `packages/api` — coordinate with
  the concurrent session!) → core SDK → commons UI → consolidate → `main` → deploy →
  Metro `-c`. SSRF: nodes require a public endpoint or the managed vault in v1.

The full original plan is at `~/.claude/plans/vale-estaba-pensando-en-polymorphic-nebula.md`.

---

## 8. Other pending (carried; not blocking F5)

- **Publish `@oxyhq/contracts` 0.4.0 → core → auth → services** — ONLY when an external
  app needs the new civic/identity types. Commons uses `workspace:*`; the api Docker
  build builds contracts from source, so no publish is needed for the current deploys.
  Publish order is strict (contracts before its consumers); verify with a clean external
  `bun add` + `import()`.
- **Commons EAS project id** (`packages/commons/app.json` `extra.eas.projectId`) — needs
  `eas init` (user's Expo login) for cloud native builds. Not needed for local `expo run`.
- **`docs-keeper`** — document the civic layer (Fases 0-4, "Oxy ID" naming, the
  `oxycommons://` scheme, the reputation screen) into `OxyHQServices/AGENTS.md`. NOT yet done.
- **Infra (oxy-infra, needs the user/AWS):** run the karma→reputation migration as a
  one-shot ECS task (balances read 0 until then); set `REC_SCORING_V2=true` in
  `terraform-uswest2/app-services.tf`. Seed `isSeedVerifier=true` on a few trusted users
  to bootstrap the personhood web-of-trust (otherwise everyone is score 0 / unverified).

---

## 9. First actions for the resuming agent

1. Read `AGENTS.md`. `git status` + `git log --oneline -8` + `git branch --show-current`.
2. Check whether the concurrent `packages/api` federation changes are still uncommitted;
   if so, stay out of `packages/api` until they land, or coordinate.
3. Confirm CI is green: `gh run list --branch main --workflow "CI/CD Pipeline" --limit 3`.
4. Ask the user which they want next: **F5** (when api is free), **docs-keeper**, device
   polish, or the publish/EAS/infra items. Then delegate to the owning agent and follow §5.
