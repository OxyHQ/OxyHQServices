import {
  getVerificationMeta,
  getTrustTierMeta,
  getPersonhoodMeta,
} from '@/lib/civic/card-presentation';

describe('getVerificationMeta', () => {
  it('maps a verified card to the positive VERIFIED indicator', () => {
    expect(getVerificationMeta(true)).toEqual({
      verified: true,
      tone: 'positive',
      labelKey: 'verified',
    });
  });

  it('maps an UNVERIFIED card to a DANGER tone (untrusted, not merely pending)', () => {
    expect(getVerificationMeta(false)).toEqual({
      verified: false,
      tone: 'danger',
      labelKey: 'unverified',
    });
  });
});

describe('getTrustTierMeta', () => {
  it('marks restricted as danger', () => {
    expect(getTrustTierMeta('restricted')).toEqual({ tone: 'danger', labelKey: 'restricted' });
  });

  it('marks new as neutral', () => {
    expect(getTrustTierMeta('new')).toEqual({ tone: 'neutral', labelKey: 'new' });
  });

  it.each(['trusted', 'high_trust', 'verified'] as const)('marks %s as positive', (tier) => {
    expect(getTrustTierMeta(tier)).toEqual({ tone: 'positive', labelKey: tier });
  });
});

describe('getPersonhoodMeta', () => {
  it('maps unverified → neutral, pending → caution, verified → positive', () => {
    expect(getPersonhoodMeta('unverified').tone).toBe('neutral');
    expect(getPersonhoodMeta('pending').tone).toBe('caution');
    expect(getPersonhoodMeta('verified').tone).toBe('positive');
  });

  it('echoes the status as the label key', () => {
    expect(getPersonhoodMeta('pending').labelKey).toBe('pending');
  });
});
