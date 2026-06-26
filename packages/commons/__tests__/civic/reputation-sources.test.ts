import { deriveReputationSources } from '@/lib/civic/reputation-sources';

describe('deriveReputationSources', () => {
  it('re-buckets the breakdown into the four ordered civic sources', () => {
    const sources = deriveReputationSources({
      content: 5,
      social: 3,
      trust: 8,
      moderation: 2,
      physical: 25,
      penalties: 10,
    });

    expect(sources).toEqual([
      { key: 'realLife', weight: 'high', points: 25 },
      { key: 'peerCivic', weight: 'medium', points: 8 },
      { key: 'apps', weight: 'low', points: 8 }, // content + social
      { key: 'penalties', weight: 'penalty', points: 10 },
    ]);
  });

  it('sums content + social into the "apps" source', () => {
    const [, , apps] = deriveReputationSources({
      content: 12,
      social: 30,
      trust: 0,
      moderation: 0,
      physical: 0,
      penalties: 0,
    });
    expect(apps).toEqual({ key: 'apps', weight: 'low', points: 42 });
  });

  it('preserves order strongest → weakest', () => {
    const sources = deriveReputationSources({
      content: 0,
      social: 0,
      trust: 0,
      moderation: 0,
      physical: 0,
      penalties: 0,
    });
    expect(sources.map((s) => s.key)).toEqual(['realLife', 'peerCivic', 'apps', 'penalties']);
  });
});
