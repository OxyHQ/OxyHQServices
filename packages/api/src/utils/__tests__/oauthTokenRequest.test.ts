/**
 * Unit tests for the `POST /auth/oauth/token` request parser.
 *
 * This is where THE DIALECT RULE is pinned: which wire shapes select RFC 6749
 * and which stay on the legacy Oxy shape, how HTTP Basic credentials are
 * decoded (RFC 6749 §2.3.1), and which malformed requests must be refused
 * rather than guessed at. The route tests cover the HTTP behaviour on top of
 * this; here we can enumerate the edge cases cheaply.
 */

import {
  decodeBasicClientCredentials,
  detectDialect,
  parseOAuthTokenRequest,
} from '../oauthTokenRequest';
import { OAuthProtocolError } from '../oauthError';
import { BadRequestError } from '../error';

const VALID_VERIFIER = 'a'.repeat(64);

function basicHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

describe('detectDialect', () => {
  it('treats a camelCase body with no RFC parameter as the legacy dialect', () => {
    expect(
      detectDialect({
        body: {
          code: 'c',
          clientId: 'oxy_dk_client',
          redirectUri: 'https://app.example/cb',
          codeVerifier: VALID_VERIFIER,
        },
      }),
    ).toBe('legacy');
  });

  it.each([
    'grant_type',
    'client_id',
    'client_secret',
    'redirect_uri',
    'code_verifier',
    'refresh_token',
  ])('treats a body carrying %s as the RFC dialect', (parameter) => {
    expect(detectDialect({ body: { [parameter]: 'value' } })).toBe('rfc6749');
  });

  it('treats an Authorization: Basic header as the RFC dialect even with a camelCase body', () => {
    expect(
      detectDialect({
        body: { code: 'c', clientId: 'oxy_dk_client', redirectUri: 'https://app.example/cb' },
        authorizationHeader: basicHeader('oxy_dk_client', 'secret'),
      }),
    ).toBe('rfc6749');
  });

  it('ignores a Bearer Authorization header — it is not client authentication', () => {
    expect(
      detectDialect({
        body: { code: 'c', clientId: 'oxy_dk_client', redirectUri: 'https://app.example/cb' },
        authorizationHeader: 'Bearer some-access-token',
      }),
    ).toBe('legacy');
  });

  it('detects the RFC dialect from a lowercase basic scheme', () => {
    expect(
      detectDialect({
        body: {},
        authorizationHeader: `basic ${Buffer.from('a:b').toString('base64')}`,
      }),
    ).toBe('rfc6749');
  });
});

describe('decodeBasicClientCredentials', () => {
  it('decodes a well-formed header', () => {
    expect(decodeBasicClientCredentials(basicHeader('oxy_dk_client', 's3cret'))).toEqual({
      clientId: 'oxy_dk_client',
      clientSecret: 's3cret',
    });
  });

  it('percent-decodes both halves per RFC 6749 §2.3.1', () => {
    const encoded = Buffer.from('client%3Aid:sec%2Fret%2Bplus').toString('base64');
    expect(decodeBasicClientCredentials(`Basic ${encoded}`)).toEqual({
      clientId: 'client:id',
      clientSecret: 'sec/ret+plus',
    });
  });

  it('splits on the FIRST colon so a secret may contain colons', () => {
    const encoded = Buffer.from('id:a:b:c').toString('base64');
    expect(decodeBasicClientCredentials(`Basic ${encoded}`)).toEqual({
      clientId: 'id',
      clientSecret: 'a:b:c',
    });
  });

  it('returns undefined when there is no Authorization header', () => {
    expect(decodeBasicClientCredentials(undefined)).toBeUndefined();
  });

  it('returns undefined for a Bearer header', () => {
    expect(decodeBasicClientCredentials('Bearer abc')).toBeUndefined();
  });

  // `Buffer.from(…, 'base64')` silently DROPS characters outside the alphabet,
  // so `aWQ6!c2VjcmV0` decodes to exactly the same `id:secret` as the untampered
  // `aWQ6c2VjcmV0`. Without an explicit alphabet check the header would be
  // accepted as valid credentials rather than rejected as malformed — this is
  // the case the check exists for, and the only one that detects its absence.
  it('rejects a header whose base64 lenient-decoding would silently repair', () => {
    const valid = Buffer.from('id:secret').toString('base64');
    const tampered = `${valid.slice(0, 4)}!${valid.slice(4)}`;
    expect(Buffer.from(tampered, 'base64').toString('utf8')).toBe('id:secret');

    expect(() => decodeBasicClientCredentials(`Basic ${tampered}`)).toThrow(
      expect.objectContaining({ oauthError: 'invalid_client' }),
    );
  });

  it.each([
    ['no credentials at all', 'Basic'],
    ['not base64', 'Basic !!!not-base64!!!'],
    ['no colon separator', `Basic ${Buffer.from('idonly').toString('base64')}`],
    ['empty client id', `Basic ${Buffer.from(':secret').toString('base64')}`],
    ['empty client secret', `Basic ${Buffer.from('id:').toString('base64')}`],
  ])('rejects a malformed header (%s) with invalid_client', (_label, header) => {
    expect(() => decodeBasicClientCredentials(header)).toThrow(OAuthProtocolError);
    try {
      decodeBasicClientCredentials(header);
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthProtocolError);
      expect((error as OAuthProtocolError).oauthError).toBe('invalid_client');
      expect((error as OAuthProtocolError).statusCode).toBe(401);
    }
  });
});

describe('parseOAuthTokenRequest — RFC 6749 dialect', () => {
  it('parses a snake_case authorization_code request with client_secret_post', () => {
    const parsed = parseOAuthTokenRequest({
      body: {
        grant_type: 'authorization_code',
        code: 'the-code',
        client_id: 'oxy_dk_client',
        client_secret: 'the-secret',
        redirect_uri: 'https://app.example/cb',
      },
    });

    expect(parsed).toEqual({
      dialect: 'rfc6749',
      grantType: 'authorization_code',
      client: { clientId: 'oxy_dk_client', clientSecret: 'the-secret', viaBasicAuth: false },
      code: 'the-code',
      redirectUri: 'https://app.example/cb',
    });
  });

  it('parses client_secret_basic credentials out of the Authorization header', () => {
    const parsed = parseOAuthTokenRequest({
      body: {
        grant_type: 'authorization_code',
        code: 'the-code',
        redirect_uri: 'https://app.example/cb',
      },
      authorizationHeader: basicHeader('oxy_dk_client', 'the-secret'),
    });

    expect(parsed.client).toEqual({
      clientId: 'oxy_dk_client',
      clientSecret: 'the-secret',
      viaBasicAuth: true,
    });
  });

  it('parses a public-client PKCE request (code_verifier, no secret)', () => {
    const parsed = parseOAuthTokenRequest({
      body: {
        grant_type: 'authorization_code',
        code: 'the-code',
        client_id: 'oxy_dk_client',
        redirect_uri: 'https://app.example/cb',
        code_verifier: VALID_VERIFIER,
      },
    });

    expect(parsed).toMatchObject({
      dialect: 'rfc6749',
      grantType: 'authorization_code',
      codeVerifier: VALID_VERIFIER,
      client: { clientId: 'oxy_dk_client', viaBasicAuth: false },
    });
    expect(parsed.client.clientSecret).toBeUndefined();
  });

  it('parses a refresh_token request', () => {
    const parsed = parseOAuthTokenRequest({
      body: {
        grant_type: 'refresh_token',
        refresh_token: 'the-refresh-token',
      },
      authorizationHeader: basicHeader('oxy_dk_client', 'the-secret'),
    });

    expect(parsed).toEqual({
      dialect: 'rfc6749',
      grantType: 'refresh_token',
      client: { clientId: 'oxy_dk_client', clientSecret: 'the-secret', viaBasicAuth: true },
      refreshToken: 'the-refresh-token',
    });
  });

  it('requires grant_type (RFC 6749 §4.1.3)', () => {
    expect(() =>
      parseOAuthTokenRequest({
        body: {
          code: 'the-code',
          client_id: 'oxy_dk_client',
          client_secret: 'the-secret',
          redirect_uri: 'https://app.example/cb',
        },
      }),
    ).toThrow(
      expect.objectContaining({ oauthError: 'invalid_request', statusCode: 400 }),
    );
  });

  it('rejects an unknown grant_type with unsupported_grant_type', () => {
    expect(() =>
      parseOAuthTokenRequest({
        body: { grant_type: 'client_credentials', client_id: 'oxy_dk_client' },
      }),
    ).toThrow(
      expect.objectContaining({ oauthError: 'unsupported_grant_type', statusCode: 400 }),
    );
  });

  it('rejects mixing HTTP Basic with a body client_secret (RFC 6749 §2.3)', () => {
    expect(() =>
      parseOAuthTokenRequest({
        body: {
          grant_type: 'authorization_code',
          code: 'the-code',
          client_secret: 'other-secret',
          redirect_uri: 'https://app.example/cb',
        },
        authorizationHeader: basicHeader('oxy_dk_client', 'the-secret'),
      }),
    ).toThrow(expect.objectContaining({ oauthError: 'invalid_request' }));
  });

  it('rejects a body client_id that contradicts the Basic header', () => {
    expect(() =>
      parseOAuthTokenRequest({
        body: {
          grant_type: 'authorization_code',
          code: 'the-code',
          client_id: 'a-different-client',
          redirect_uri: 'https://app.example/cb',
        },
        authorizationHeader: basicHeader('oxy_dk_client', 'the-secret'),
      }),
    ).toThrow(expect.objectContaining({ oauthError: 'invalid_request' }));
  });

  it('accepts a body client_id that agrees with the Basic header', () => {
    const parsed = parseOAuthTokenRequest({
      body: {
        grant_type: 'authorization_code',
        code: 'the-code',
        client_id: 'oxy_dk_client',
        redirect_uri: 'https://app.example/cb',
      },
      authorizationHeader: basicHeader('oxy_dk_client', 'the-secret'),
    });
    expect(parsed.client.clientId).toBe('oxy_dk_client');
  });

  it('rejects a repeated parameter (RFC 6749 §3.1 forbids duplicates)', () => {
    expect(() =>
      parseOAuthTokenRequest({
        body: {
          grant_type: 'authorization_code',
          code: ['one', 'two'],
          client_id: 'oxy_dk_client',
          client_secret: 'the-secret',
          redirect_uri: 'https://app.example/cb',
        },
      }),
    ).toThrow(expect.objectContaining({ oauthError: 'invalid_request' }));
  });

  it('requires a client_id when no Basic header is present', () => {
    expect(() =>
      parseOAuthTokenRequest({
        body: {
          grant_type: 'authorization_code',
          code: 'the-code',
          redirect_uri: 'https://app.example/cb',
        },
      }),
    ).toThrow(expect.objectContaining({ oauthError: 'invalid_request' }));
  });

  it('requires either a client_secret or a code_verifier on the code grant', () => {
    expect(() =>
      parseOAuthTokenRequest({
        body: {
          grant_type: 'authorization_code',
          code: 'the-code',
          client_id: 'oxy_dk_client',
          redirect_uri: 'https://app.example/cb',
        },
      }),
    ).toThrow(expect.objectContaining({ oauthError: 'invalid_request' }));
  });

  it('rejects a redirect_uri that is not a URL', () => {
    expect(() =>
      parseOAuthTokenRequest({
        body: {
          grant_type: 'authorization_code',
          code: 'the-code',
          client_id: 'oxy_dk_client',
          client_secret: 'the-secret',
          redirect_uri: 'not-a-url',
        },
      }),
    ).toThrow(expect.objectContaining({ oauthError: 'invalid_request' }));
  });

  it('rejects a code_verifier shorter than the PKCE minimum of 43 characters', () => {
    expect(() =>
      parseOAuthTokenRequest({
        body: {
          grant_type: 'authorization_code',
          code: 'the-code',
          client_id: 'oxy_dk_client',
          redirect_uri: 'https://app.example/cb',
          code_verifier: 'too-short',
        },
      }),
    ).toThrow(expect.objectContaining({ oauthError: 'invalid_request' }));
  });

  it('requires refresh_token on the refresh grant', () => {
    expect(() =>
      parseOAuthTokenRequest({
        body: { grant_type: 'refresh_token', client_id: 'oxy_dk_client' },
      }),
    ).toThrow(expect.objectContaining({ oauthError: 'invalid_request' }));
  });

  it('carries an optional scope through on the refresh grant', () => {
    const parsed = parseOAuthTokenRequest({
      body: {
        grant_type: 'refresh_token',
        client_id: 'oxy_dk_client',
        refresh_token: 'rt',
        scope: 'user:read',
      },
    });
    expect(parsed).toMatchObject({ grantType: 'refresh_token', scope: 'user:read' });
  });
});

describe('parseOAuthTokenRequest — legacy dialect', () => {
  it('parses the camelCase body @oxyhq/core sends', () => {
    const parsed = parseOAuthTokenRequest({
      body: {
        code: 'the-code',
        clientId: 'oxy_dk_client',
        redirectUri: 'https://app.example/cb',
        codeVerifier: VALID_VERIFIER,
      },
    });

    expect(parsed).toEqual({
      dialect: 'legacy',
      grantType: 'authorization_code',
      client: { clientId: 'oxy_dk_client', viaBasicAuth: false },
      code: 'the-code',
      redirectUri: 'https://app.example/cb',
      codeVerifier: VALID_VERIFIER,
    });
  });

  it('accepts a confidential legacy client sending clientSecret', () => {
    const parsed = parseOAuthTokenRequest({
      body: {
        code: 'the-code',
        clientId: 'oxy_dk_client',
        redirectUri: 'https://app.example/cb',
        clientSecret: 'the-secret',
      },
    });
    expect(parsed.client).toEqual({
      clientId: 'oxy_dk_client',
      clientSecret: 'the-secret',
      viaBasicAuth: false,
    });
  });

  it('fails legacy validation with the UNCHANGED BadRequestError envelope', () => {
    let thrown: unknown;
    try {
      parseOAuthTokenRequest({
        body: { code: 'the-code', clientId: 'oxy_dk_client' },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadRequestError);
    expect(thrown).not.toBeInstanceOf(OAuthProtocolError);
    const apiError = thrown as BadRequestError;
    expect(apiError.statusCode).toBe(400);
    expect(apiError.toJSON()).toMatchObject({
      error: 'BAD_REQUEST',
      message: 'Validation failed',
    });
  });

  it('rejects a non-object body in the legacy dialect', () => {
    expect(() => parseOAuthTokenRequest({ body: 'not-an-object' })).toThrow(BadRequestError);
  });
});
