import type { Provider, ProviderIdentity } from '../types.js';
import { createOAuthProvider } from './router.js';

const AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_SCOPES = ['openid', 'email', 'profile'] as const;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export type GoogleOptions = {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  scopes?: string[];
};

type GoogleToken = {
  accessToken: string;
};

function parseToken(value: unknown): GoogleToken | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('access_token' in value) ||
    typeof value.access_token !== 'string' ||
    value.access_token.length === 0
  ) {
    return null;
  }

  return { accessToken: value.access_token };
}

function parseIdentity(value: unknown): ProviderIdentity | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('sub' in value) ||
    typeof value.sub !== 'string' ||
    value.sub.length === 0
  ) {
    return null;
  }

  return {
    avatarUrl:
      'picture' in value && typeof value.picture === 'string'
        ? value.picture
        : undefined,
    email:
      'email' in value && typeof value.email === 'string'
        ? value.email
        : undefined,
    emailVerified:
      'email_verified' in value && typeof value.email_verified === 'boolean'
        ? value.email_verified
        : undefined,
    id: value.sub,
    name:
      'name' in value && typeof value.name === 'string'
        ? value.name
        : undefined,
    raw: value,
  };
}

export function google(options: GoogleOptions): Provider {
  if (!options.clientId) {
    throw new Error('google_client_id_required');
  }

  if (!options.clientSecret) {
    throw new Error('google_client_secret_required');
  }

  const configuredScopes = options.scopes ?? [];

  return createOAuthProvider({
    authorizationUrl({ callbackURL, scopes, state }) {
      const url = new URL(AUTHORIZATION_URL);
      const requestedScopes = new Set([
        ...DEFAULT_SCOPES,
        ...configuredScopes,
        ...(scopes ?? []),
      ]);

      url.searchParams.set('client_id', options.clientId);
      url.searchParams.set('redirect_uri', callbackURL);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', [...requestedScopes].join(' '));
      url.searchParams.set('state', state);

      return url;
    },
    async callback({ callbackURL, code }) {
      const fetcher = options.fetch ?? globalThis.fetch;
      const tokenResponse = await fetcher(TOKEN_URL, {
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: callbackURL,
        }),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      });
      const tokenValue: unknown = await tokenResponse.json().catch(() => null);
      const token = parseToken(tokenValue);

      if (!tokenResponse.ok || !token) {
        throw new Error('google_token_exchange_failed');
      }

      const identityResponse = await fetcher(USERINFO_URL, {
        headers: { authorization: `Bearer ${token.accessToken}` },
      });
      const identityValue: unknown = await identityResponse
        .json()
        .catch(() => null);
      const identity = parseIdentity(identityValue);

      if (!identityResponse.ok || !identity) {
        throw new Error('google_identity_failed');
      }

      return identity;
    },
  });
}
