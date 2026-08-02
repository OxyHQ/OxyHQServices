/**
 * OAuth 2.0 / OpenID Connect discovery document.
 *
 * A relying party reads this ONCE and then builds every subsequent request from
 * it, so a wrong value here is a silent, total integration failure. These tests
 * pin the things a conforming client actually keys off:
 *
 *  - both well-known paths (RFC 8414 §3 and OIDC Discovery §4) serve it;
 *  - `issuer` matches the URL the document was fetched from, minus the
 *    well-known suffix (OIDC Discovery §4.3) — otherwise clients reject it;
 *  - the advertised capabilities are the ones the token endpoint implements,
 *    including `client_secret_basic` (the MAS default) and the `refresh_token`
 *    grant;
 *  - it advertises nothing it cannot honour: no `jwks_uri`, no ID-token signing
 *    algorithms, no `email_verified` claim.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const ISSUER = 'https://api.oxy.test';
const AUTHORIZATION_ENDPOINT = 'https://auth.oxy.test/authorize';

process.env.OAUTH_ISSUER = ISSUER;
process.env.OAUTH_AUTHORIZATION_ENDPOINT = AUTHORIZATION_ENDPOINT;

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import oauthMetadataRouter from '../oauthMetadata';

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

async function get(path: string): Promise<HttpResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method: 'GET', host: '127.0.0.1', port: address.port, path },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: raw.length > 0 ? JSON.parse(raw) : {},
            });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use('/', oauthMetadataRouter);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

describe('GET /.well-known/openid-configuration', () => {
  it('is served at the OIDC Discovery path', async () => {
    const res = await get('/.well-known/openid-configuration');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('is served at the RFC 8414 path with an identical document', async () => {
    const oidc = await get('/.well-known/openid-configuration');
    const rfc8414 = await get('/.well-known/oauth-authorization-server');
    expect(rfc8414.status).toBe(200);
    expect(rfc8414.body).toEqual(oidc.body);
  });

  it('advertises the configured issuer and endpoints', async () => {
    const res = await get('/.well-known/openid-configuration');
    expect(res.body).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: AUTHORIZATION_ENDPOINT,
      token_endpoint: `${ISSUER}/auth/oauth/token`,
      userinfo_endpoint: `${ISSUER}/auth/oauth/userinfo`,
    });
  });

  it('advertises client_secret_basic (the MAS default) and client_secret_post', async () => {
    const res = await get('/.well-known/openid-configuration');
    expect(res.body.token_endpoint_auth_methods_supported).toEqual(
      expect.arrayContaining(['client_secret_basic', 'client_secret_post']),
    );
  });

  it('advertises the authorization_code and refresh_token grants', async () => {
    const res = await get('/.well-known/openid-configuration');
    expect(res.body.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
  });

  it('advertises only the code response type and only S256 PKCE', async () => {
    const res = await get('/.well-known/openid-configuration');
    expect(res.body.response_types_supported).toEqual(['code']);
    expect(res.body.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('advertises the OIDC scopes UserInfo can satisfy', async () => {
    const res = await get('/.well-known/openid-configuration');
    expect(res.body.scopes_supported).toEqual(
      expect.arrayContaining(['openid', 'profile', 'email']),
    );
  });

  it('claims no ID-token capability it does not have (no jwks_uri, no signing algs)', async () => {
    const res = await get('/.well-known/openid-configuration');
    expect(res.body).not.toHaveProperty('jwks_uri');
    expect(res.body).not.toHaveProperty('id_token_signing_alg_values_supported');
    expect(res.body.response_types_supported).not.toContain('id_token');
  });

  it('does not advertise an email_verified claim Oxy cannot prove', async () => {
    const res = await get('/.well-known/openid-configuration');
    expect(res.body.claims_supported).toEqual(
      expect.arrayContaining(['sub', 'preferred_username', 'email']),
    );
    expect(res.body.claims_supported).not.toContain('email_verified');
  });

  it('is publicly cacheable and CORS-open', async () => {
    const res = await get('/.well-known/openid-configuration');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cache-control']).toContain('public');
  });
});
