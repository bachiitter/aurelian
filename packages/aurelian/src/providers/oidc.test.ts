import {
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose';
import { describe, expect, it } from 'vitest';
import { oidc } from './oidc.js';

describe('oidc', () => {
  it('discovers endpoints and verifies the ID token and UserInfo subject', async () => {
    const issuer = 'https://provider.example.com';
    const keyPair = await generateKeyPair('ES256', { extractable: true });
    const publicKey = await exportJWK(keyPair.publicKey);
    const provider = oidc({
      clientId: 'client_id',
      clientSecret: 'client_secret',
      fetch: async (input) => {
        const url = String(input);

        if (url.endsWith('/.well-known/openid-configuration')) {
          return Response.json({
            authorization_endpoint: `${issuer}/authorize`,
            issuer,
            jwks_uri: `${issuer}/jwks`,
            token_endpoint: `${issuer}/token`,
            userinfo_endpoint: `${issuer}/userinfo`,
          });
        }

        if (url.endsWith('/token')) {
          const idToken = await new SignJWT({ nonce: 'state_123' })
            .setAudience('client_id')
            .setIssuer(issuer)
            .setProtectedHeader({ alg: 'ES256', kid: 'key_1' })
            .setSubject('user_123')
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(keyPair.privateKey);

          return Response.json({
            access_token: 'access_token',
            id_token: idToken,
          });
        }

        if (url.endsWith('/jwks')) {
          return Response.json({
            keys: [{ ...publicKey, alg: 'ES256', kid: 'key_1', use: 'sig' }],
          });
        }

        if (url.endsWith('/userinfo')) {
          return Response.json({
            email: 'user@example.com',
            email_verified: true,
            sub: 'user_123',
          });
        }

        return new Response(null, { status: 404 });
      },
      issuer,
    });
    const authorization = await provider.authorizationUrl({
      callbackURL: 'https://auth.example.com/oidc/callback',
      request: new Request('https://auth.example.com'),
      state: 'state_123',
    });
    const identity = await provider.callback({
      callbackURL: 'https://auth.example.com/oidc/callback',
      code: 'code_123',
      request: new Request('https://auth.example.com'),
      state: 'state_123',
    });

    expect(authorization.searchParams.get('nonce')).toBe('state_123');
    expect(identity).toMatchObject({
      email: 'user@example.com',
      emailVerified: true,
      id: 'user_123',
    });
  });
});
