import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
} from 'jose';
import type { Provider } from '../types.js';
import { createOAuthProvider } from './router.js';

export type OIDCOptions = {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  issuer: string;
  scopes?: string[];
  tokenEndpointAuthMethod?: 'client_secret_basic' | 'client_secret_post';
};

export function oidc(options: OIDCOptions): Provider {
  if (!options.clientId || !options.clientSecret) {
    throw new Error('oidc_client_credentials_required');
  }

  const issuer = options.issuer.replace(/\/$/, '');
  const fetcher = options.fetch ?? globalThis.fetch;
  const metadataPromise = (async function () {
    const response = await fetcher(`${issuer}/.well-known/openid-configuration`);
    const value: unknown = await response.json().catch(() => null);

    if (
      !response.ok ||
      typeof value !== 'object' ||
      value === null ||
      !('issuer' in value) ||
      value.issuer !== issuer ||
      !('authorization_endpoint' in value) ||
      typeof value.authorization_endpoint !== 'string' ||
      !('token_endpoint' in value) ||
      typeof value.token_endpoint !== 'string' ||
      !('jwks_uri' in value) ||
      typeof value.jwks_uri !== 'string'
    ) {
      throw new Error('oidc_discovery_failed');
    }

    return {
      authorizationURL: value.authorization_endpoint,
      jwksURL: value.jwks_uri,
      tokenURL: value.token_endpoint,
      userinfoURL:
        'userinfo_endpoint' in value &&
        typeof value.userinfo_endpoint === 'string'
          ? value.userinfo_endpoint
          : undefined,
    };
  })();
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

  async function getJWKS(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    if (jwks) {
      return jwks;
    }

    const metadata = await metadataPromise;

    jwks = createRemoteJWKSet(
      new URL(metadata.jwksURL),
      options.fetch ? { [customFetch]: options.fetch } : undefined,
    );
    return jwks;
  }

  return createOAuthProvider({
    async authorizationUrl({ callbackURL, scopes, state }) {
      const metadata = await metadataPromise;
      const url = new URL(metadata.authorizationURL);
      const requestedScopes = new Set([
        'openid',
        'email',
        'profile',
        ...(options.scopes ?? []),
        ...(scopes ?? []),
      ]);

      url.searchParams.set('client_id', options.clientId);
      url.searchParams.set('redirect_uri', callbackURL);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', [...requestedScopes].join(' '));
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', state);

      return url;
    },
    async callback({ callbackURL, code, state }) {
      const [metadata, remoteJwks] = await Promise.all([
        metadataPromise,
        getJWKS(),
      ]);
      const body = new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackURL,
      });
      const headers: Record<string, string> = {
        'content-type': 'application/x-www-form-urlencoded',
      };

      if (options.tokenEndpointAuthMethod === 'client_secret_post') {
        body.set('client_id', options.clientId);
        body.set('client_secret', options.clientSecret);
      } else {
        const clientId = new URLSearchParams({ value: options.clientId })
          .toString()
          .slice(6);
        const clientSecret = new URLSearchParams({ value: options.clientSecret })
          .toString()
          .slice(6);
        headers.authorization = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
      }

      const tokenResponse = await fetcher(metadata.tokenURL, {
        body,
        headers,
        method: 'POST',
      });
      const token: unknown = await tokenResponse.json().catch(() => null);

      if (
        !tokenResponse.ok ||
        typeof token !== 'object' ||
        token === null ||
        !('access_token' in token) ||
        typeof token.access_token !== 'string' ||
        !('id_token' in token) ||
        typeof token.id_token !== 'string'
      ) {
        throw new Error('oidc_token_exchange_failed');
      }

      const idToken = await jwtVerify(token.id_token, remoteJwks, {
        audience: options.clientId,
        issuer,
        requiredClaims: ['exp', 'iat', 'sub'],
      });

      if (
        typeof idToken.payload.sub !== 'string' ||
        idToken.payload.nonce !== state ||
        (idToken.payload.azp !== undefined &&
          idToken.payload.azp !== options.clientId) ||
        (Array.isArray(idToken.payload.aud) &&
          idToken.payload.aud.length > 1 &&
          idToken.payload.azp !== options.clientId)
      ) {
        throw new Error('oidc_id_token_invalid');
      }

      let claims: unknown = idToken.payload;

      if (metadata.userinfoURL) {
        const userinfoResponse = await fetcher(metadata.userinfoURL, {
          headers: { authorization: `Bearer ${token.access_token}` },
        });
        const userinfo: unknown = await userinfoResponse
          .json()
          .catch(() => null);

        if (
          !userinfoResponse.ok ||
          typeof userinfo !== 'object' ||
          userinfo === null ||
          !('sub' in userinfo) ||
          userinfo.sub !== idToken.payload.sub
        ) {
          throw new Error('oidc_userinfo_failed');
        }

        claims = userinfo;
      }

      if (typeof claims !== 'object' || claims === null) {
        throw new Error('oidc_identity_failed');
      }

      return {
        avatarUrl:
          'picture' in claims && typeof claims.picture === 'string'
            ? claims.picture
            : undefined,
        email:
          'email' in claims && typeof claims.email === 'string'
            ? claims.email
            : undefined,
        emailVerified:
          'email_verified' in claims &&
          typeof claims.email_verified === 'boolean'
            ? claims.email_verified
            : undefined,
        id: idToken.payload.sub,
        name:
          'name' in claims && typeof claims.name === 'string'
            ? claims.name
            : undefined,
        raw: claims,
        username:
          'preferred_username' in claims &&
          typeof claims.preferred_username === 'string'
            ? claims.preferred_username
            : undefined,
      };
    },
  });
}
