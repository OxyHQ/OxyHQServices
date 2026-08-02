/**
 * THE INVARIANT of the backfill script, pinned against the REAL write path.
 *
 * `scripts/normalize-user-text-fields.ts` exists to bring records written BEFORE
 * the text-normalization fix into the state the fixed write path produces. That
 * is only true if it normalizes by the same rules, so this suite runs the SAME
 * input through both and asserts the persisted text is identical:
 *
 *   write path → `userService.updateUserProfile`, then the STORED row and its
 *                child rows are read back out of Postgres
 *   backfill   → `buildUserTextUpdate`, the `$set` payload
 *
 * Why it matters beyond tidiness: the backfill writes with the RAW driver, which
 * runs no validators. A second, hand-written copy of the normalization policy
 * that drifts from the real one can persist a value the write path would have
 * refused — a `linksMetadata` entry whose `url` normalized to `''`, say — and the
 * breakage surfaces later, over a link card the user cannot see or fix.
 *
 * ## What changed, and why the comparison is per-leaf
 *
 * The suite this replaces ran the write path against a MOCKED Mongoose document
 * and read `set.mock.calls` — the arguments handed to `user.set(field, value)` —
 * as a stand-in for "what will be persisted". Since the port those arguments do
 * not exist: `updateUserProfile` writes columns and child rows through drizzle.
 * A mock-argument comparison would now be a comparison of two things neither of
 * which is stored.
 *
 * The two sides also no longer share a SHAPE. The write path stores
 * `linksMetadata` and `locations` as child tables and `name` as two flat
 * columns; the backfill still emits the nested Mongo documents. Only the
 * normalized TEXT is common to both, and the text is the entire subject of the
 * invariant — so each case extracts the same text leaves from both sides and
 * compares those. A shape-level `toEqual` would be asserting that the port never
 * happened.
 *
 * SCOPE. `bio` / `description` / `address` are compared with markup-free input:
 * the backfill deliberately replays only the WHITESPACE half of the write path's
 * `sanitizePlainText` (see the SCOPE note in the script header), and the two
 * agree over exactly that domain — the whole domain of the bug it cleans up.
 */

import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { asc, eq } from 'drizzle-orm';
import { closePostgres, connectPostgres, getDb } from '../../config/postgres';
import { userLinkMetadata } from '../../db/schema/userLinkMetadata';
import { userLocations } from '../../db/schema/userLocations';
import { users } from '../../db/schema/users';
import { userService } from '../../services/user.service';
import type { ProfileUpdateInput } from '../../types/user.types';
import {
  MAX_LINK_TITLE_LENGTH,
  MAX_LOCATION_TEXT_LENGTH,
} from '../../utils/profileTextNormalization';
import { buildUserTextUpdate } from '../normalize-user-text-fields';

const uniqueId = () => randomUUID().replace(/-/g, '');

/** The fields under test, typed as the WRITE PATH's own input. */
type ProfileFields = ProfileUpdateInput;

/**
 * The normalized TEXT both paths must agree on, extracted from whichever shape
 * each of them produces. Absent keys mean "this case did not exercise the
 * field".
 */
interface NormalizedText {
  name?: { first?: string; last?: string };
  bio?: string;
  description?: string;
  address?: string;
  links?: string[];
  linksMetadata?: Array<{ url: string; title: string; description: string }>;
  locations?: Array<{
    id: string;
    name: string;
    label: string | null;
    city: string | null;
    formattedAddress: string | null;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

async function makeUser(): Promise<string> {
  const id = uniqueId();
  await getDb()
    .insert(users)
    .values({ id, username: `u${id}`, email: `${id}@example.test` });
  return id;
}

/**
 * Run the REAL write path and read back what it STORED — the `users` row plus
 * both child tables — projected onto the shared text shape.
 */
async function persistedByWritePath(fields: ProfileFields): Promise<NormalizedText> {
  const userId = await makeUser();
  await userService.updateUserProfile(userId, fields);

  const [row] = await getDb()
    .select({
      nameFirst: users.nameFirst,
      nameLast: users.nameLast,
      bio: users.bio,
      description: users.description,
      address: users.address,
      links: users.links,
    })
    .from(users)
    .where(eq(users.id, userId));

  const result: NormalizedText = {};

  if (fields.name !== undefined) {
    result.name = {
      first: row.nameFirst ?? undefined,
      last: row.nameLast ?? undefined,
    };
  }
  if (fields.bio !== undefined) result.bio = row.bio ?? '';
  if (fields.description !== undefined) result.description = row.description ?? '';
  if (fields.address !== undefined) result.address = row.address ?? '';
  if (fields.links !== undefined) result.links = row.links ?? [];

  if (fields.linksMetadata !== undefined) {
    const cards = await getDb()
      .select({
        url: userLinkMetadata.url,
        title: userLinkMetadata.title,
        description: userLinkMetadata.description,
      })
      .from(userLinkMetadata)
      .where(eq(userLinkMetadata.userId, userId))
      .orderBy(asc(userLinkMetadata.position));
    result.linksMetadata = cards;
  }

  if (fields.locations !== undefined) {
    const places = await getDb()
      .select({
        id: userLocations.locationKey,
        name: userLocations.name,
        label: userLocations.label,
        city: userLocations.city,
        formattedAddress: userLocations.formattedAddress,
      })
      .from(userLocations)
      .where(eq(userLocations.userId, userId))
      .orderBy(asc(userLocations.locationKey));
    result.locations = places;
  }

  return result;
}

/**
 * Run the backfill over the SAME input and project its result onto the shared
 * text shape. An absent key in the `$set` means "already clean", which must
 * equal what is on disk — so the original value is used for those.
 */
function persistedByBackfill(fields: ProfileFields): NormalizedText {
  const update = buildUserTextUpdate({
    _id: new mongoose.Types.ObjectId(),
    ...fields,
  });
  const effective = (key: keyof ProfileFields): unknown =>
    key in update ? update[key] : fields[key];

  const result: NormalizedText = {};

  if (fields.name !== undefined) {
    const name = effective('name');
    result.name = isRecord(name)
      ? { first: optionalString(name.first), last: optionalString(name.last) }
      : {};
  }
  if (fields.bio !== undefined) result.bio = optionalString(effective('bio')) ?? '';
  if (fields.description !== undefined) {
    result.description = optionalString(effective('description')) ?? '';
  }
  if (fields.address !== undefined) {
    result.address = optionalString(effective('address')) ?? '';
  }
  if (fields.links !== undefined) {
    const links = effective('links');
    result.links = Array.isArray(links) ? links.filter((l): l is string => typeof l === 'string') : [];
  }

  if (fields.linksMetadata !== undefined) {
    const cards = effective('linksMetadata');
    result.linksMetadata = (Array.isArray(cards) ? cards : []).filter(isRecord).map((card) => ({
      url: optionalString(card.url) ?? '',
      title: optionalString(card.title) ?? '',
      description: optionalString(card.description) ?? '',
    }));
  }

  if (fields.locations !== undefined) {
    const places = effective('locations');
    result.locations = (Array.isArray(places) ? places : [])
      .filter(isRecord)
      .map((place) => {
        const address = isRecord(place.address) ? place.address : {};
        return {
          id: optionalString(place.id) ?? '',
          name: optionalString(place.name) ?? '',
          label: nullableString(place.label),
          city: nullableString(address.city),
          formattedAddress: nullableString(address.formattedAddress),
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  return result;
}

/** The reported bug: a remote `<title>` served across indented source lines. */
const INDENTED_REMOTE_TITLE = '\n      Mi título\n    ';

const PARITY_CASES: Array<{ label: string; fields: ProfileFields }> = [
  {
    label: 'an indented remote <title> and a multi-line description',
    fields: {
      linksMetadata: [
        {
          url: ' https://example.com ',
          title: INDENTED_REMOTE_TITLE,
          description: 'Una   descripción\ncon salto',
          image: 'file-id',
        },
      ],
    },
  },
  {
    label: 'a link card whose URL normalizes to nothing',
    fields: {
      linksMetadata: [
        { url: '   ', title: 'Sin URL', description: 'D' },
        { url: 'https://example.com', title: 'Con URL', description: 'D' },
      ],
    },
  },
  {
    label: 'an over-long scraped title (length cap)',
    fields: {
      linksMetadata: [
        {
          url: 'https://example.com',
          title: `${'a'.repeat(MAX_LINK_TITLE_LENGTH)} desbordado`,
          description: 'D',
        },
      ],
    },
  },
  {
    label: 'a Nominatim display_name and an over-long place name',
    fields: {
      locations: [
        {
          id: 'loc-1',
          name: `  Plaça   de Catalunya ${'!'.repeat(MAX_LOCATION_TEXT_LENGTH)}`,
          label: 'Home\noffice',
          address: { city: ' Barcelona ', formattedAddress: 'Plaça de Catalunya,\n  Barcelona' },
          coordinates: { lat: 41.3, lon: 2.1 },
        },
      ],
    },
  },
  {
    label: 'profile links with padding and an empty entry',
    fields: { links: [' https://a.example ', '   ', 'https://b.example'] },
  },
  {
    label: 'a display name padded with a run of spaces',
    fields: { name: { first: `Ana${' '.repeat(20)}`, last: ' Gómez ' } },
  },
  {
    label: 'free text with blank lines made of spaces (markup-free — see SCOPE)',
    fields: {
      bio: 'Primera línea\n   \n   \nSegunda línea',
      description: 'Descripción   sucia',
      address: '  12 Baker St  ',
    },
  },
];

beforeAll(async () => {
  await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

describe('backfill / write-path parity', () => {
  it.each(PARITY_CASES)(
    'the backfill normalizes exactly what the write path stores: $label',
    async ({ fields }) => {
      const fromWritePath = await persistedByWritePath(fields);
      const fromBackfill = persistedByBackfill(fields);

      expect(fromBackfill).toEqual(fromWritePath);
    }
  );

  it('is a no-op over its own output — a re-run writes nothing', async () => {
    // "A re-run writes nothing" is the idempotency guarantee the script's header
    // claims and the reason it is safe to run twice. It is only checkable by
    // feeding the FIRST pass's output back in, which the old suite never did.
    for (const { fields } of PARITY_CASES) {
      const first = buildUserTextUpdate({ _id: new mongoose.Types.ObjectId(), ...fields });
      const second = buildUserTextUpdate({
        _id: new mongoose.Types.ObjectId(),
        ...fields,
        ...first,
      });
      expect(second).toEqual({});
    }
  });

  it('emits nothing at all for an already-clean record', async () => {
    // The counterpart: a clean document must not be rewritten, or the one-shot
    // becomes a full-collection write every time it runs.
    expect(
      buildUserTextUpdate({
        _id: new mongoose.Types.ObjectId(),
        name: { first: 'Ana', last: 'Gómez' },
        bio: 'Primera línea\n\nSegunda línea',
        links: ['https://a.example'],
        linksMetadata: [{ url: 'https://example.com', title: 'T', description: 'D' }],
        locations: [{ id: 'loc-1', name: 'Barcelona', address: { city: 'Barcelona' } }],
      })
    ).toEqual({});
  });

  it('never emits a link card the write path would refuse (`url` is required)', async () => {
    const update = buildUserTextUpdate({
      _id: new mongoose.Types.ObjectId(),
      linksMetadata: [
        { url: '', title: 'T', description: 'D' },
        { url: '\n  \n', title: 'T', description: 'D' },
        { title: 'Sin url', description: 'D' },
        'not-an-object',
        { url: ' https://ok.example ', title: 'T', description: 'D' },
      ],
    });

    // The backfill writes with the raw driver, which runs NO validators: an
    // entry with an empty `url` would be persisted and would then break the
    // user's next profile save.
    expect(update.linksMetadata).toEqual([
      { url: 'https://ok.example', title: 'T', description: 'D' },
    ]);

    // ...and the write path agrees, by DROPPING the same entries — which is the
    // parity claim for this case, stated against stored rows rather than
    // asserted of the backfill alone.
    const userId = await makeUser();
    await userService.updateUserProfile(userId, {
      linksMetadata: [
        { url: '', title: 'T', description: 'D' },
        { url: '\n  \n', title: 'T', description: 'D' },
        { url: ' https://ok.example ', title: 'T', description: 'D' },
      ],
    });

    const stored = await getDb()
      .select({ url: userLinkMetadata.url })
      .from(userLinkMetadata)
      .where(eq(userLinkMetadata.userId, userId));
    expect(stored).toEqual([{ url: 'https://ok.example' }]);
  });
});
