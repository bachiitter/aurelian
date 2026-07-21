import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { createHash, createRandomString } from './crypto.js';
import type { AccessTokenClaims, TokenResponse, VerifyResult } from './types.js';

export type CreateClientOptions = {
  audience?: string | string[];
  fetch?: typeof fetch;
  issuer: string;
  redirectURI?: string;
  storage?: OAuthStorage;
};

export type AuthorizeOptions = {
  provider: string;
  redirectURI?: string;
  scopes?: string[];
  state?: string;
};

export type OAuthStorage = {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
};

export type PKCEChallenge = {
  challenge: string;
  method: 'S256';
  verifier: string;
};

export type AuthorizeResult = {
  challenge: PKCEChallenge;
  state: string;
  url: URL;
};

export type { TokenResponse, VerifyResult };

export function createClient<Profile = unknown>(options: CreateClientOptions) {
  const issuer = options.issuer.replace(/\/$/, '');
  const request = options.fetch ?? globalThis.fetch;
  const transactionPrefix = `aurelian:${issuer}:oauth`;
  const jwks = createRemoteJWKSet(
    new URL(`${issuer}/.well-known/jwks.json`),
    options.fetch ? { [customFetch]: options.fetch } : undefined,
  );

  return {
    async authenticate<Body>(
      provider: string,
      body: Body,
    ): Promise<TokenResponse> {
      return postToken(request, `${issuer}/authenticate/${provider}`, body);
    },
    async authorize(input: AuthorizeOptions): Promise<AuthorizeResult> {
      const state = input.state ?? createRandomString(32);
      const url = new URL(`${issuer}/authorize/${input.provider}`);
      const challenge = await createPKCEChallenge();
      const redirectURI = input.redirectURI ?? options.redirectURI;
      const storage = options.storage ?? globalThis.sessionStorage;

      if (!redirectURI) {
        throw new Error('oauth_redirect_uri_required');
      }

      if (!storage) {
        throw new Error('oauth_storage_required');
      }

      const transactionKey = `${transactionPrefix}:${state}`;

      if (
        storage.getItem(`${transactionKey}:verifier`) !== null ||
        storage.getItem(`${transactionKey}:redirect-uri`) !== null
      ) {
        throw new Error('oauth_state_in_use');
      }

      storage.setItem(`${transactionKey}:verifier`, challenge.verifier);
      storage.setItem(`${transactionKey}:redirect-uri`, redirectURI);

      url.searchParams.set('redirect_uri', redirectURI);
      url.searchParams.set('state', state);

      if (input.scopes?.length) {
        url.searchParams.set('scope', input.scopes.join(' '));
      }

      url.searchParams.set('code_challenge', challenge.challenge);
      url.searchParams.set('code_challenge_method', challenge.method);

      return { challenge, state, url };
    },
    async exchange(input: {
      code: string;
      codeVerifier?: string;
      redirectURI: string;
    }): Promise<TokenResponse> {
      return postToken(request, `${issuer}/token`, input);
    },
    async handleCallback(input?: {
      url?: string | URL;
    }): Promise<TokenResponse> {
      const callbackURL = input?.url
        ? new URL(input.url)
        : typeof globalThis.location === 'undefined'
          ? null
          : new URL(globalThis.location.href);
      const storage = options.storage ?? globalThis.sessionStorage;
      const code = callbackURL?.searchParams.get('code');
      const state = callbackURL?.searchParams.get('state');
      const providerError = callbackURL?.searchParams.get('error');

      if (!storage) {
        throw new Error('oauth_storage_required');
      }

      if (!state) {
        throw new Error('oauth_callback_invalid');
      }

      const transactionKey = `${transactionPrefix}:${state}`;
      const codeVerifier = storage.getItem(`${transactionKey}:verifier`);
      const redirectURI = storage.getItem(`${transactionKey}:redirect-uri`);

      if (!codeVerifier || !redirectURI) {
        throw new Error('oauth_state_invalid');
      }

      storage.removeItem(`${transactionKey}:verifier`);
      storage.removeItem(`${transactionKey}:redirect-uri`);

      if (providerError) {
        throw new Error('oauth_provider_error');
      }

      if (!code) {
        throw new Error('oauth_callback_invalid');
      }

      return postToken(request, `${issuer}/token`, {
        code,
        codeVerifier,
        redirectURI,
      });
    },
    async refresh(input: { refreshToken: string }): Promise<TokenResponse> {
      return postToken(request, `${issuer}/token/refresh`, input);
    },
    async revoke(input: { refreshToken: string }): Promise<void> {
      const response = await request(`${issuer}/token/revoke`, {
        body: JSON.stringify(input),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('token_revoke_failed');
      }
    },
    async verify(accessToken: string): Promise<VerifyResult<Profile>> {
      try {
        const result = await jwtVerify(accessToken, jwks, {
          audience: options.audience,
          issuer,
        });
        if (
          result.payload.typ !== 'access' ||
          typeof result.payload.sid !== 'string' ||
          result.payload.profile === undefined
        ) {
          return { reason: 'token_invalid', valid: false };
        }

        const profile = result.payload.profile as Profile;
        const claims: AccessTokenClaims<Profile> = {
          ...result.payload,
          profile,
          sid: result.payload.sid,
          typ: result.payload.typ,
        };

        return {
          claims,
          profile,
          valid: true,
        };
      } catch {
        return { reason: 'token_invalid', valid: false };
      }
    },
  };
}

export async function createPKCEChallenge(): Promise<PKCEChallenge> {
  const verifier = createRandomString(64);

  return {
    challenge: await createHash(verifier),
    method: 'S256',
    verifier,
  };
}

async function postToken(
  request: typeof fetch,
  url: string,
  body: unknown,
): Promise<TokenResponse> {
  const response = await request(url, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('token_request_failed');
  }

  const value: unknown = await response.json();

  if (
    typeof value !== 'object' ||
    value === null ||
    !('accessToken' in value) ||
    typeof value.accessToken !== 'string' ||
    !('expiresIn' in value) ||
    typeof value.expiresIn !== 'number' ||
    !('refreshToken' in value) ||
    typeof value.refreshToken !== 'string' ||
    !('tokenType' in value) ||
    value.tokenType !== 'Bearer'
  ) {
    throw new Error('token_response_invalid');
  }

  return {
    accessToken: value.accessToken,
    expiresIn: value.expiresIn,
    refreshToken: value.refreshToken,
    tokenType: value.tokenType,
  };
}
