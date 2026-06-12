import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

export type IdentityProfile<
  Type extends string = string,
  Properties extends Record<string, unknown> = Record<string, unknown>,
> = {
  properties: Properties;
  type: Type;
};

export type CreateClientOptions = {
  audience?: string;
  clientID?: string;
  fetch?: typeof fetch;
  issuer: string;
};

export type AuthorizeOptions = {
  pkce?: boolean;
  provider: string;
  redirectURI: string;
  scopes?: string[];
  state?: string;
};

export type PKCEChallenge = {
  challenge: string;
  method: 'S256';
  verifier: string;
};

export type AuthorizeResult = {
  challenge?: PKCEChallenge;
  state: string;
  url: URL;
};

export type TokenResponse = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  tokenType: 'Bearer';
};

export type VerifyResult<Profile extends IdentityProfile = IdentityProfile> =
  | { claims: JWTPayload; profile: Profile; valid: true }
  | { reason: string; valid: false };

export function createClient<Profile extends IdentityProfile = IdentityProfile>(options: CreateClientOptions) {
  const issuer = options.issuer.replace(/\/$/, '');
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const request = options.fetch ?? fetch;

  return {
    async authorize(input: AuthorizeOptions): Promise<AuthorizeResult> {
      const state = input.state ?? generateRandomString(32);
      const url = new URL(`${issuer}/${input.provider}/authorize`);
      const challenge = input.pkce ? await createPKCEChallenge() : undefined;

      url.searchParams.set('redirect_uri', input.redirectURI);
      url.searchParams.set('state', state);

      if (options.clientID) {
        url.searchParams.set('client_id', options.clientID);
      }

      if (input.scopes && input.scopes.length > 0) {
        url.searchParams.set('scope', input.scopes.join(' '));
      }

      if (challenge) {
        url.searchParams.set('code_challenge', challenge.challenge);
        url.searchParams.set('code_challenge_method', challenge.method);
      }

      return { challenge, state, url };
    },
    async exchange(input: { code: string; codeVerifier?: string; redirectURI: string }): Promise<TokenResponse> {
      return postToken(request, `${issuer}/token`, input);
    },
    async refresh(input: { refreshToken: string }): Promise<TokenResponse> {
      return postToken(request, `${issuer}/token/refresh`, input);
    },
    async revoke(input: { refreshToken: string }): Promise<void> {
      const response = await request(`${issuer}/token/revoke`, {
        body: JSON.stringify(input),
        headers: {
          'content-type': 'application/json',
        },
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
        const profile = result.payload.profile;

        if (!isIdentityProfile(profile)) {
          return { reason: 'profile_invalid', valid: false };
        }

        return { claims: result.payload, profile: profile as Profile, valid: true };
      } catch {
        return { reason: 'token_invalid', valid: false };
      }
    },
  };
}

export async function createPKCEChallenge(): Promise<PKCEChallenge> {
  const verifier = generateRandomString(64);
  const challenge = await sha256Base64Url(verifier);

  return {
    challenge,
    method: 'S256',
    verifier,
  };
}

async function postToken(request: typeof fetch, url: string, body: unknown): Promise<TokenResponse> {
  const response = await request(url, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('token_request_failed');
  }

  const json = await response.json();

  if (!isTokenResponse(json)) {
    throw new Error('token_response_invalid');
  }

  return json;
}

function isIdentityProfile(value: unknown): value is IdentityProfile {
  if (!isRecord(value) || typeof value.type !== 'string' || !isRecord(value.properties)) {
    return false;
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTokenResponse(value: unknown): value is TokenResponse {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.accessToken === 'string'
    && typeof value.expiresIn === 'number'
    && typeof value.refreshToken === 'string'
    && value.tokenType === 'Bearer';
}

function generateRandomString(length: number): string {
  const requiredBytes = Math.ceil((length * 3) / 4);
  const buffer = new Uint8Array(requiredBytes);

  globalThis.crypto.getRandomValues(buffer);

  return base64UrlEncode(buffer).slice(0, length);
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);

  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
