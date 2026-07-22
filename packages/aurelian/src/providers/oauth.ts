import type { ProviderIdentity } from '../profiles.js';
import type { MaybePromise, OAuthProvider } from '../types.js';

export type OAuthIdentityInput = {
  accessToken: string;
  fetch: typeof fetch;
  request: Request;
  token: unknown;
};

export type OAuthOptions = {
  authorizationParams?: Record<string, string>;
  authorizationURL: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  identify(input: OAuthIdentityInput): MaybePromise<ProviderIdentity>;
  scopes?: string[];
  tokenEndpointAuthMethod?: 'client_secret_basic' | 'client_secret_post';
  tokenURL: string;
};

export function oauth(options: OAuthOptions): OAuthProvider {
  if (!options.clientId || !options.clientSecret) {
    throw new Error('oauth_client_credentials_required');
  }

  const fetcher = options.fetch ?? globalThis.fetch;

  return {
    authorizationUrl({ callbackURL, scopes, state }) {
      const url = new URL(options.authorizationURL);
      const requestedScopes = new Set([
        ...(options.scopes ?? []),
        ...(scopes ?? []),
      ]);

      for (const [key, value] of Object.entries(
        options.authorizationParams ?? {},
      )) {
        url.searchParams.set(key, value);
      }

      url.searchParams.set('client_id', options.clientId);
      url.searchParams.set('redirect_uri', callbackURL);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('state', state);

      if (requestedScopes.size) {
        url.searchParams.set('scope', [...requestedScopes].join(' '));
      }

      return url;
    },
    async callback({ callbackURL, code, request }) {
      const body = new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackURL,
      });
      const headers: Record<string, string> = {
        accept: 'application/json',
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

      const tokenResponse = await fetcher(options.tokenURL, {
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
        token.access_token.length === 0
      ) {
        throw new Error('oauth_token_exchange_failed');
      }

      return options.identify({
        accessToken: token.access_token,
        fetch: fetcher,
        request,
        token,
      });
    },
    type: 'oauth',
  };
}
