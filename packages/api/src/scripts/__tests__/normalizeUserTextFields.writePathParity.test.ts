/**
 * THE INVARIANT of the backfill script, pinned.
 *
 * `scripts/normalize-user-text-fields.ts` exists to bring documents written
 * BEFORE the text-normalization fix into the state the fixed write path produces.
 * That is only true if it normalizes by the same rules — so this suite runs the
 * SAME input through both and asserts the persisted result is byte-identical:
 *
 *   write path  → `userService.updateUserProfile` (what `user.set(field, value)`
 *                 receives is exactly what Mongoose will save)
 *   backfill    → `buildUserTextUpdate` (the `$set` payload)
 *
 * Why this matters beyond tidiness: the backfill writes with the RAW driver
 * (`collection.bulkWrite`), which does not run Mongoose validators. A second,
 * hand-written copy of the normalization policy that drifts from the real one can
 * therefore persist a sub-document the schema forbids — e.g. a `linksMetadata`
 * entry whose `url` normalized to `''`, when `url`/`title`/`description` are
 * `required: true` — and the breakage surfaces later, as a validation error on the
 * user's next profile save, over a link card they cannot see or fix. The parity
 * asserted here is what makes that impossible.
 *
 * SCOPE. `bio` / `description` / `address` are compared with markup-free input:
 * the backfill deliberately replays only the WHITESPACE half of the write path's
 * `sanitizePlainText` (see the SCOPE note in the script header), and the two agree
 * byte for byte over exactly that domain — which is the whole domain of the bug it
 * cleans up.
 */

// The global jest.setup.cjs mocks `mongoose` wholesale, stripping `Schema.Types`.
// `user.service.ts` imports the real `Follow` model, whose schema references
// `Schema.Types.ObjectId` at module load — so restore the actual mongoose module.
// The User/Subscription models ARE mocked below.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
    findOne: jest.fn(),
  },
}));

jest.mock('../../models/Subscription', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}));

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: jest.fn() },
}));

jest.mock('../../services/securityActivityService', () => ({
  __esModule: true,
  default: { logEmailChange: jest.fn(), logProfileUpdate: jest.fn() },
}));

import mongoose from 'mongoose';
import User from '../../models/User';
import { userService } from '../../services/user.service';
import type { ProfileUpdateInput } from '../../types/user.types';
import {
  MAX_LINK_TITLE_LENGTH,
  MAX_LOCATION_TEXT_LENGTH,
} from '../../utils/profileTextNormalization';
import { buildUserTextUpdate } from '../normalize-user-text-fields';

const mockUser = User as jest.Mocked<typeof User>;

const OBJECT_ID = new mongoose.Types.ObjectId();

/**
 * The fields under test, typed as the WRITE PATH's own input. A stored document is
 * the same shape with `unknown` leaves, so one case object drives both paths.
 */
type ProfileFields = ProfileUpdateInput;

/**
 * Run the REAL write path and return what it would persist, field by field:
 * `updateUserProfile` applies its result with `user.set(key, value)`, so the mock's
 * `set` calls ARE the document state that `save()` is about to write.
 */
async function persistedByWritePath(fields: ProfileFields): Promise<Record<string, unknown>> {
  const set = jest.fn<(key: string, value: unknown) => void>();
  (mockUser.findById as jest.Mock).mockReturnValueOnce({
    select: jest.fn().mockReturnValue({
      _id: 'user-1',
      username: 'alice',
      email: 'user@example.com',
      set,
      save: jest.fn().mockResolvedValue(undefined),
      toObject: jest.fn().mockReturnValue({ _id: 'user-1' }),
    }),
  });

  await userService.updateUserProfile('user-1', fields);

  const persisted: Record<string, unknown> = {};
  for (const [key, value] of set.mock.calls) {
    persisted[key] = value;
  }
  return persisted;
}

/**
 * Run the backfill and return the resulting document state: the `$set` value for
 * every field it rewrites, and the STORED value for every field it leaves alone
 * (an absent key means "already clean", which must equal what is on disk).
 */
function persistedByBackfill(fields: ProfileFields): Record<string, unknown> {
  const update = buildUserTextUpdate({ _id: OBJECT_ID, ...fields });

  const persisted: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) {
    persisted[key] = key in update ? update[key] : fields[key as keyof ProfileFields];
  }
  return persisted;
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
    label: 'a link card whose URL normalizes to nothing (the schema requires `url`)',
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

describe('backfill / write-path parity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(PARITY_CASES)(
    'the backfill persists exactly what the write path persists: $label',
    async ({ fields }) => {
      const fromWritePath = await persistedByWritePath(fields);
      const fromBackfill = persistedByBackfill(fields);

      expect(fromBackfill).toEqual(fromWritePath);
    }
  );

  it('never emits a link card the User schema would reject (`url` is required)', () => {
    const update = buildUserTextUpdate({
      _id: OBJECT_ID,
      linksMetadata: [
        { url: '', title: 'T', description: 'D' },
        { url: '\n  \n', title: 'T', description: 'D' },
        { title: 'Sin url', description: 'D' },
        'not-an-object',
        { url: ' https://ok.example ', title: 'T', description: 'D' },
      ],
    });

    // The backfill writes with the raw driver, which runs NO Mongoose validators:
    // an entry with an empty `url` would be persisted and would then fail the
    // `required` validator on the user's next profile save.
    expect(update.linksMetadata).toEqual([
      { url: 'https://ok.example', title: 'T', description: 'D' },
    ]);
  });
});
