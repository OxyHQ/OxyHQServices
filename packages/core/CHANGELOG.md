# Changelog — `@oxyhq/core`

## 15.0.0

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
