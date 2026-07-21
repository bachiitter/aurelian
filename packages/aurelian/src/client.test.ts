import { describe, expect, it } from 'vitest';
import { createClient } from './client.js';

describe('createClient OAuth', () => {
  it('stores PKCE state and exchanges the frontend callback', async () => {
    const values = new Map<string, string>();
    const requests: Array<{ body: unknown; url: string }> = [];
    let storedValuesAtExchange = -1;
    const tokens = {
      accessToken: 'access_token',
      expiresIn: 600,
      refreshToken: 'refresh_token',
      tokenType: 'Bearer' as const,
    };
    const client = createClient({
      fetch: async (input, init) => {
        storedValuesAtExchange = values.size;
        requests.push({
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
          url: String(input),
        });

        return Response.json(tokens);
      },
      issuer: 'https://auth.example.com/auth',
      redirectURI: 'https://app.example.com/callback',
      storage: {
        getItem(key) {
          return values.get(key) ?? null;
        },
        removeItem(key) {
          values.delete(key);
        },
        setItem(key, value) {
          values.set(key, value);
        },
      },
    });
    const authorization = await client.authorize({ provider: 'github' });
    const result = await client.handleCallback({
      url: `https://app.example.com/callback?code=provider_code&state=${authorization.state}`,
    });

    expect(authorization.url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/callback',
    );
    expect(authorization.url.searchParams.get('code_challenge')).toBe(
      authorization.challenge.challenge,
    );
    expect(result).toEqual(tokens);
    expect(requests).toEqual([
      {
        body: {
          code: 'provider_code',
          codeVerifier: authorization.challenge.verifier,
          redirectURI: 'https://app.example.com/callback',
        },
        url: 'https://auth.example.com/auth/token',
      },
    ]);
    expect(storedValuesAtExchange).toBe(0);
    expect(values.size).toBe(0);

    const deniedAuthorization = await client.authorize({ provider: 'github' });

    await expect(
      client.handleCallback({
        url: `https://app.example.com/callback?error=access_denied&state=${deniedAuthorization.state}`,
      }),
    ).rejects.toThrow('oauth_provider_error');
    expect(values.size).toBe(0);
  });

  it('rejects malformed token responses', async () => {
    const client = createClient({
      fetch: async () => Response.json({ accessToken: 'incomplete' }),
      issuer: 'https://auth.example.com/auth',
    });

    await expect(
      client.authenticate('password', { password: 'secret' }),
    ).rejects.toThrow('token_response_invalid');
  });
});
