/**
 * Unit tests for the backfill script's core diff function
 * (`buildUserTextUpdate` in `../normalize-user-text-fields`).
 *
 * There is NO mongoose connection here: the script's `main()` is behind a
 * `require.main === module` guard, so importing the module only pulls in the pure
 * function. What matters is the IDEMPOTENCE contract — the script must produce an
 * empty `$set` for a document that is already clean, so a re-run performs zero
 * writes.
 */

import mongoose from 'mongoose';
import { buildUserTextUpdate, type StoredUserDoc } from '../normalize-user-text-fields';

const OBJECT_ID = new mongoose.Types.ObjectId();

function storedUser(fields: Omit<StoredUserDoc, '_id'>): StoredUserDoc {
  return { _id: OBJECT_ID, ...fields };
}

describe('buildUserTextUpdate', () => {
  it('normalizes the indented remote <title> stored in linksMetadata', () => {
    const update = buildUserTextUpdate(
      storedUser({
        linksMetadata: [
          {
            url: 'https://example.com',
            title: '\n      Mi título\n    ',
            description: 'Una   descripción',
            image: 'file-id',
          },
        ],
      })
    );

    expect(update).toEqual({
      linksMetadata: [
        {
          url: 'https://example.com',
          title: 'Mi título',
          description: 'Una descripción',
          image: 'file-id',
        },
      ],
    });
  });

  it('collapses a run of spaces in a stored display name and drops the stale `full` virtual', () => {
    const update = buildUserTextUpdate(
      storedUser({ name: { first: 'Ana   ', last: 'Gómez', full: 'Ana    Gómez' } })
    );

    expect(update).toEqual({ name: { first: 'Ana', last: 'Gómez' } });
  });

  it('collapses blank lines made of spaces in a stored bio, keeping real paragraphs', () => {
    const update = buildUserTextUpdate(
      storedUser({ bio: 'Primera\n   \n   \nSegunda\n\nTercera' })
    );

    expect(update).toEqual({ bio: 'Primera\n\nSegunda\n\nTercera' });
  });

  it('normalizes location text and the Nominatim-sourced formatted address', () => {
    const update = buildUserTextUpdate(
      storedUser({
        locations: [
          {
            id: 'loc-1',
            name: 'Plaça   de Catalunya',
            address: { city: ' Barcelona ', formattedAddress: 'Plaça de Catalunya,\n Barcelona' },
            coordinates: { lat: 41.3, lon: 2.1 },
          },
        ],
      })
    );

    expect(update).toEqual({
      locations: [
        {
          id: 'loc-1',
          name: 'Plaça de Catalunya',
          address: { city: 'Barcelona', formattedAddress: 'Plaça de Catalunya, Barcelona' },
          coordinates: { lat: 41.3, lon: 2.1 },
        },
      ],
    });
  });

  it('trims stored links and drops empty entries', () => {
    const update = buildUserTextUpdate(storedUser({ links: [' https://a.example ', '  '] }));

    expect(update).toEqual({ links: ['https://a.example'] });
  });

  it('touches ONLY the fields that actually change', () => {
    const update = buildUserTextUpdate(
      storedUser({
        name: { first: 'Ada', last: 'Lovelace' },
        bio: 'Clean bio',
        description: 'Descripción   sucia',
      })
    );

    expect(update).toEqual({ description: 'Descripción sucia' });
  });

  it('produces an EMPTY update for an already-clean document (a re-run writes nothing)', () => {
    const update = buildUserTextUpdate(
      storedUser({
        name: { first: 'Ada', last: 'Lovelace' },
        bio: 'Primera\n\nSegunda',
        description: 'Limpio',
        address: '12 Baker St',
        links: ['https://a.example'],
        linksMetadata: [{ url: 'https://example.com', title: 'T', description: 'D' }],
        locations: [{ id: 'loc-1', name: 'Barcelona' }],
      })
    );

    expect(update).toEqual({});
  });

  it('is idempotent: re-running over its own output produces no further change', () => {
    const dirty = storedUser({
      name: { first: 'Ana   ', last: 'Gómez' },
      bio: 'Primera\n   \n   \nSegunda',
      linksMetadata: [{ url: 'https://example.com', title: '\n  Título\n', description: 'D' }],
    });

    const first = buildUserTextUpdate(dirty);
    expect(Object.keys(first).length).toBeGreaterThan(0);

    const second = buildUserTextUpdate(storedUser(first));
    expect(second).toEqual({});
  });

  it('leaves a document with none of the affected fields untouched', () => {
    expect(buildUserTextUpdate(storedUser({}))).toEqual({});
  });
});
