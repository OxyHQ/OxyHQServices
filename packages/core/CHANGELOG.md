# Changelog — `@oxyhq/core`

## 17.0.2

### Fixes `17.0.0`, which could not be imported at all

`17.0.0` shipped `@oxyhq/core/server/userInvalidation`, which imports
`OXY_USER_INVALIDATION_CHANNEL`, `isPublishedOxyUserChangeReason` and
`oxyUserInvalidationEventSchema` from `@oxyhq/contracts` — but it pinned
`@oxyhq/contracts@^0.20.0`, and `0.20.0` exports none of them. A clean install of
`17.0.0` therefore failed on any import of `@oxyhq/core/server`:

```
The requested module '@oxyhq/contracts' does not provide an export named
'OXY_USER_INVALIDATION_CHANNEL'
```

That subpath carries `createOxyAuthMiddleware`, `safeFetch`, `createOxyCors` and
`verifySecret`, so a backend on `17.0.0` did not boot. `17.0.2` pins
`@oxyhq/contracts@^0.21.0`, which is the version that actually exports the symbols.
`17.0.0` is deprecated; no consumer had bumped to it. (`17.0.1` was versioned on
`main` but never published, so `17.0.2` is the first release carrying its changes.)

Nothing else changed. `17.0.1`'s wider cache sweep and `17.0.0`'s helpers are
unmodified — this release exists solely to correct the dependency range.

## 17.0.1

### `@oxyhq/core/server` — cross-service identity cache eviction

`evictOxyIdentityCache` now sweeps the same session-bound and `/users/me` prefixes
the user mixin clears after a local profile write, plus `GET:/auth/lookup/` (login-flow
lookup cache). Without these, a cross-service invalidation left stale identity in
session-scoped caches for up to five minutes.

New exports from `@oxyhq/core/server` (shipped in `17.0.0`, documented here):
`publishOxyUserInvalidation`, `createOxyUserInvalidationHandler`, `evictOxyIdentityCache`.

## 17.0.0

Shipped the invalidation publish/consume helpers on `@oxyhq/core/server` for Oxy backends
that cache identity via `OxyServices`. See `packages/core/src/server/userInvalidation.ts`.

## 16.1.0

### Display-name policy — separators admitted, swastika ideographs denied

`isValidDisplayName` / `cleanDisplayName` now admit four punctuation separators that
join real names (`·`, `־`, `་`, `・`) when flanked by letters, and reject the two
swastika ideographs (`卍`, `卐`) that slipped through the letter-only allowlist.

**Minor rather than patch:** the same input can return a different verdict than
`16.0.0` (e.g. `Codeur·euses` is now valid). No API surface changed beyond
`DISPLAY_NAME_INVALID_MESSAGE` (new export for shared client/server copy).

## 16.0.0

### BREAKING — `getServiceAssetMetadataByIds` fails closed by default

Failed chunks now throw `ServiceAssetMetadataError` instead of being swallowed.
A throttled or errored bulk lookup is no longer indistinguishable from “these ids
do not exist”. Pass `{ partial: true }` to keep the previous swallow behaviour as
an explicit opt-in.

### BREAKING — `express-rate-limit` peer range is `^8.0.0`

`server/rateLimit.ts` passes `validate: { keyGeneratorIpFallback: false }`, which
requires v8. The peer previously admitted v7, so nested installs could shadow the
root v8 devDependency and fail `tsc`.

## 15.0.0

### BREAKING — the reputation types moved to `@oxyhq/contracts`

`@oxyhq/core` no longer exports **any** reputation type, nor
`isFullReputationBalance`. The whole family now lives in `@oxyhq/contracts`
(`>= 0.20.0`), which the API's serializers are annotated and validated against —
so a server-side change to the wire shape fails the build instead of silently
diverging from the SDK type, which is what produced the view-split bug below.

**Migration:** change the import source, nothing else. The type names and their
meanings are unchanged.

```diff
-import type { ReputationBalance, TrustTier } from '@oxyhq/core';
-import { isFullReputationBalance } from '@oxyhq/core';
+import type { ReputationBalance, TrustTier } from '@oxyhq/contracts';
+import { isFullReputationBalance } from '@oxyhq/contracts';
```

Affected: `ReputationCategory`, `TrustTier`, `ReputationTransactionStatus`,
`ReputationTargetEntityType`, `ReputationDisputeStatus`,
`ReputationInfluenceContext`, `ReputationTransaction`,
`ReputationBalanceBreakdown`, `ReputationInfluence`, `ReputationReliability`,
`ReputationBalanceSummary`, `ReputationBalance`, `ReputationBalanceView`,
`ReputationDispute`, `ReputationRule`, `ReputationLeaderboardEntry`,
`ReputationInfluenceResult`, `ReverseReputationTransactionResult`,
`AwardReputationInput`, `CreateReputationDisputeInput`,
`ResolveReputationDisputeInput`, `UpsertReputationRuleInput`,
`ReverseReputationTransactionInput`, and `isFullReputationBalance`.

**One shape changed as well.** `ReputationLeaderboardEntry.user` was
`Pick<User, …> & Partial<User>`; it is now the pinned
**`ReputationLeaderboardUser`** (`id`, `username`, `name`, `avatar?`,
`publicKey?`). The API was emitting Mongo's `_id` on that object, so `user.id`
was `undefined` for every leaderboard row — it now really is the user id.

### BREAKING — reputation balance view split

`GET /reputation/:userId/balance` has always served two shapes (subject/staff vs
public), but the SDK type still declared the full `ReputationBalance` for every
caller. That let `balance.reliability.*` type-check on a stranger's balance and
throw at runtime.

- **`getReputationBalance(userId)`** now returns **`ReputationBalanceView`**
  (`ReputationBalance | ReputationBalanceSummary`). Only `userId`, `total`, and
  `trustTier` are reachable without narrowing.
- **`getMyReputationBalance()`** — new ergonomic path for the signed-in user's
  own balance; returns **`ReputationBalance`** directly and throws
  `OxyAuthenticationError` when the server answers with the public view (absent
  or lapsed token).
- **`isFullReputationBalance(balance)`** — type guard to narrow
  `ReputationBalanceView` to `ReputationBalance`.
- New types: **`ReputationBalanceSummary`**, **`ReputationBalanceView`**.

**Migration:** for your own balance, call `getMyReputationBalance()`. For a
third party's `total` / `trustTier`, keep `getReputationBalance(userId)`. For
private fields on an arbitrary id (subject or staff only), narrow with
`isFullReputationBalance()` before reading `breakdown`, `influence`, or
`reliability`.

## 14.0.0

Same content as 13.2.0, republished under a correct major. See the 13.2.0 entry
below for what actually changed — everything there applies here.

`13.2.0` is **deprecated on npm** and points at this version.

## 13.2.0 — DEPRECATED (shipped a breaking change under a MINOR)

> **Read this if you consume `@oxyhq/core` directly.** 13.2.0 contains a
> **runtime-breaking change to a publicly exported function** and was published
> as a MINOR, so a `^13.0.0` range could pick it up silently. It has since been
> deprecated, and npm now resolves `^13.0.0` to `13.0.0` rather than `13.2.0`;
> installing `13.2.0` explicitly still works but warns. The identical content is
> available as **14.0.0** under the correct major — prefer `^14.0.0`.

### BREAKING — `buildPaginationParams` return type

`buildPaginationParams(params)` now returns a plain **`Record<string, string>`**.
It previously returned a **`URLSearchParams`**.

**You are affected if** you call `URLSearchParams` methods on the result —
`.toString()`, `.get()`, `.append()`, `.set()`, `.has()`, `.entries()`,
`.forEach()`, or iterate it with `for...of`. Those now throw a `TypeError`,
because a plain object has none of them. This is a runtime failure, not a
compile error, so TypeScript will not necessarily catch it for you.

**Migration:** use `buildSearchParams(params)`, which is unchanged and still
returns a `URLSearchParams`.

```ts
// before
const qs = buildPaginationParams({ limit: 20 }).toString();
// after
const qs = buildSearchParams({ limit: 20 }).toString();
```

**You are NOT affected if** you passed the result to `makeRequest` /
`HttpService` — the overwhelmingly common use, and the one this change exists to
repair. That path was already broken; see below.

### Fixed — follow-graph pagination was silently ignored, and every page shared one cache entry

`buildPaginationParams` returned a `URLSearchParams`, which was then handed to
`makeRequest` as a GET's `params`. `HttpService` inspects that object with
`Object.keys(...)` in two places — `buildURL`, to decide whether to append a
query string, and `generateBaseCacheKey`, to build the request's cache key — and
`Object.keys(new URLSearchParams({ limit: '20' }))` is `[]`, because a
`URLSearchParams` exposes its entries through iterator methods rather than own
enumerable properties. Both guards therefore saw an empty object.

Two consequences, both silent at the call site:

- **No query string was ever sent.** `getUserFollowers`, `getUserFollowing`,
  `getUserMutuals`, `getMutualUserIds` and `getFollowsOfFollowsIds` all returned
  the server's default page no matter what `limit`/`offset` the caller passed.
- **Every page collapsed onto ONE cache key**, so a request for page 2 was served
  page 1's cached body without a network call.

```
before  GET /users/abc/followers
        cache key  GET:/users/abc/followers
after   GET /users/abc/followers?limit=20&offset=40
        cache key  GET:/users/abc/followers:{"limit":"20","offset":"40"}
```

`buildSearchParams` and `buildUrl` are unchanged in behaviour (their parameter
types were widened to a generic, which is strictly more permissive).

### Fixed — follow/unfollow did not invalidate the follower/following lists

`followUser`, `unfollowUser`, `followUsers` and `unfollowUsers` cleared
`follow-status`, `/users/:id`, the profile caches and `/users/me/graph`, but
never `/users/:id/followers`, `/users/:id/mutuals`, or the viewer's own
`/users/:id/following`. With the cache key fixed above, those lists became
properly content-addressed, so stale variants would have multiplied instead of
collapsing onto one entry.

All four mutation paths now funnel through a single
`invalidateFollowGraphCaches` helper, which clears the lists **by prefix** — one
logical list spans many keys (one per `limit`/`offset`/`sort` combination), so an
exact-key clear would only bust whichever page happened to be read last.

### Added — `sort` on the follow-graph reads

`getUserFollowers`, `getUserFollowing` and `getUserMutuals` accept
`sort?: 'recent' | 'oldest'` via the new `FollowGraphParams` type. Omitted leaves
the server default (`recent`). The shared `PaginationParams` is deliberately
unchanged — many endpoints have no `sort`.

New exports: `buildQueryParams`, and the types `FollowGraphSort` /
`FollowGraphParams`.
