/**
 * `user_locations` — a place a user saved on their profile.
 *
 * Ported from the `locations` array embedded in `models/User.ts`.
 *
 * A child table was not a judgement call: SEVEN indexes hung off `locations.*`
 * paths, including a text index and a 2dsphere. `address.*` and `metadata.*`
 * flatten to columns for the same reason — they are indexed, and `jsonb` cannot
 * serve an indexed path without a hand-written expression index per path.
 *
 * ## Coordinates are ported as a FIX, not replicated
 *
 * Mongo stored `{ lat, lon }` and indexed it with `2dsphere`. A 2dsphere index
 * over an object reads the pair POSITIONALLY as `[longitude, latitude]` — the
 * first field is longitude — so the live index has almost certainly had every
 * point transposed for its whole life. Two NAMED columns make that class of bug
 * unrepresentable: there is no ordering left to get wrong. (`ST_MakePoint(lon,
 * lat)` is the same fix spelled in PostGIS's argument order.)
 *
 * ## There is no spatial index, and none is needed
 *
 * `findLocationsNear` (`locationQueryService.ts:29`) is a real `$near` /
 * `$maxDistance` query, and its Postgres equivalent would need PostGIS —
 * `geography(Point, 4326)` plus a GiST index. It does not travel, because
 * **nothing calls it**: `@oxyhq/core`, `@oxyhq/services` and all seven consuming
 * apps contain zero references to `location-search` / `locationSearch` /
 * `findLocationsNear`. The routes are mounted (`server.ts:586`, behind auth) and
 * unreachable from the ecosystem. Installing PostGIS in dev, CI and RDS to index
 * a query with no consumer is the definition of carrying something for its own
 * sake.
 *
 * Not "deferred" — not required. If a client ever needs distance search, adding
 * it is purely additive against these columns: `add column geo
 * geography(Point, 4326)` backfilled from `ST_MakePoint(longitude, latitude)`,
 * plus a GiST index. No reshaping, no re-backfill.
 *
 * What was deliberately NOT done in the meantime: no `earthdistance`/`cube`
 * stand-in, and no bounding box dressed up as a distance. A wrong "nearby" is
 * worse than an absent one.
 *
 * The location DATA is live regardless of the dead endpoints — people search
 * matches on `name`, `city` and `country` (`utils/profileQuery.ts:97-102`, via
 * `routes/search.ts:45`), which is why the non-spatial indexes below stay.
 */

import { sql } from 'drizzle-orm';
import { check, doublePrecision, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, tsvector, updatedAt } from './columns';
import { users } from './users';

/** What the user calls this place. */
export const USER_LOCATION_TYPES = ['home', 'work', 'school', 'other'] as const;

/**
 * The text-search configuration behind `search_vector`, matching the Mongo text
 * index's `default_language: "en"`. A LITERAL, because the one-argument
 * `to_tsvector` is STABLE and Postgres refuses it in a generated column.
 */
const SEARCH_CONFIGURATION = 'english';

/**
 * `name` + `formatted_address`, the two fields Mongo's text index covered.
 *
 * The column names are spelled in SQL here because a generated expression is
 * built before the table object exists, so there are no drizzle columns to
 * interpolate. That is the one place in this schema where a hand-written SQL
 * name is unavoidable — `__tests__/users.test.ts` asserts the resulting column
 * actually populates, so a name that drifts fails rather than silently indexing
 * nothing.
 */
const SEARCH_VECTOR_EXPRESSION = sql.raw(
  `to_tsvector('${SEARCH_CONFIGURATION}', ` +
    `coalesce(name, '') || ' ' || coalesce(formatted_address, ''))`
);

export const userLocations = pgTable(
  'user_locations',
  {
    id: generatedId(),
    /**
     * The owner. `CASCADE` — a saved place has no meaning without the profile
     * it was saved on.
     */
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * The client-supplied handle every call site addresses this row by
     * (`removeLocation(locationId)`, `updateLocationCoordinates(locationId, …)`),
     * carried over verbatim. It is NOT the primary key: it comes from the
     * client, so it is unique only within one user, which is what the index
     * below states.
     */
    locationKey: text().notNull(),
    name: text().notNull(),
    label: text(),
    type: text({ enum: USER_LOCATION_TYPES }).notNull().default('other'),

    // ---- address ----------------------------------------------------------
    street: text(),
    streetNumber: text(),
    streetDetails: text(),
    postalCode: text(),
    city: text(),
    state: text(),
    country: text(),
    formattedAddress: text(),

    // ---- coordinates ------------------------------------------------------
    /** Degrees north, [-90, 90]. NAMED, so it can never be read as a longitude. */
    latitude: doublePrecision(),
    /** Degrees east, [-180, 180]. */
    longitude: doublePrecision(),

    // ---- geocoder metadata ------------------------------------------------
    placeId: text(),
    osmId: text(),
    osmType: text(),
    countryCode: text(),
    timezone: text(),

    /** GENERATED — the replacement for Mongo's text index on this table. */
    searchVector: tsvector().generatedAlwaysAs(SEARCH_VECTOR_EXPRESSION),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Leads with `user_id`, so it also answers every "this user's locations"
    // read — which is every read there is. No separate `user_id` index.
    uniqueIndex('user_locations_user_id_location_key_key').on(t.userId, t.locationKey),

    // Mongo declared seven indexes on these paths; three were redundant, since a
    // btree serves any leading prefix of a compound:
    //   {address.city}          — covered by (city, country)
    //   {type}                  — covered by (type, city)
    //   {address.country} is NOT covered by (city, country), so it stays.
    index('user_locations_city_country_idx').on(t.city, t.country),
    index('user_locations_country_idx').on(t.country),
    index('user_locations_type_city_idx').on(t.type, t.city),
    index('user_locations_country_code_city_idx').on(t.countryCode, t.city),
    // Mongo also indexed `locations.createdAt` and `locations.updatedAt`
    // descending. Dropped: nothing in the codebase orders or filters locations
    // by either, and an index nobody uses still costs every write.
    index('user_locations_search_vector_idx').using('gin', t.searchVector),
    // NOTE for the call-site port: these are ports of the indexes Mongo
    // declared, and they serve equality and prefix reads. The one live consumer
    // of this data — people search — matches with an UNANCHORED
    // case-insensitive substring pattern (`utils/profileQuery.ts:97-102`), which
    // none of them can serve, exactly as none of Mongo's could. It is a scan
    // today and it will be a scan on port. If it needs indexing, `pg_trgm` is
    // the tool and it is already available; do not assume these cover it.

    check(
      'user_locations_type_check',
      sql`${t.type} in (${sql.raw(USER_LOCATION_TYPES.map((value) => `'${value}'`).join(', '))})`
    ),
    // Mongo's `min`/`max` on the two coordinate paths.
    check(
      'user_locations_latitude_check',
      sql`${t.latitude} is null or (${t.latitude} >= -90 and ${t.latitude} <= 90)`
    ),
    check(
      'user_locations_longitude_check',
      sql`${t.longitude} is null or (${t.longitude} >= -180 and ${t.longitude} <= 180)`
    ),
    // Half a coordinate is not a place. Mongo permitted `{ lat }` with no `lon`,
    // and every consumer had to guard for it; here the pair is whole or absent.
    check(
      'user_locations_coordinates_complete_check',
      sql`(${t.latitude} is null) = (${t.longitude} is null)`
    ),
  ]
);
