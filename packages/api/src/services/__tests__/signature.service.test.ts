import SignatureService from '../signature.service';

describe('SignatureService timestamp freshness', () => {
  const publicKey =
    '04' + 'a'.repeat(128);
  const signature = 'deadbeef';

  beforeEach(() => {
    jest.spyOn(SignatureService, 'verifySignature').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects challenge responses with a future timestamp', () => {
    const future = Date.now() + 60_000;
    expect(
      SignatureService.verifyChallengeResponse(
        publicKey,
        'challenge',
        signature,
        future
      )
    ).toBe(false);
  });

  it('rejects registration signatures with a future timestamp', () => {
    const future = Date.now() + 60_000;
    expect(
      SignatureService.verifyRegistrationSignature(publicKey, signature, future)
    ).toBe(false);
  });

  it('rejects request signatures with a future timestamp', () => {
    const future = Date.now() + 60_000;
    expect(
      SignatureService.verifyRequestSignature(
        publicKey,
        { action: 'test' },
        signature,
        future
      )
    ).toBe(false);
  });
});
