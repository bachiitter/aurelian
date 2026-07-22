import { describe, expect, it } from 'vitest';
import { oauth } from './oauth.js';

describe('oauth', () => {
  it('exchanges a code and delegates identity loading', async () => {
    const requests: Array<{
      authorization: string | null;
      body: string;
      url: string;
    }> = [];
    const provider = oauth({
      authorizationParams: { prompt: 'consent', state: 'ignored' },
      authorizationURL: 'https://provider.example.com/authorize',
      clientId: 'client_id',
      clientSecret: 'client_secret',
      fetch: async (input, init) => {
        requests.push({
          authorization: new Headers(init?.headers).get('authorization'),
          body: String(init?.body),
          url: String(input),
        });
        return Response.json({ access_token: 'access_token' });
      },
      identify({ accessToken }) {
        return { id: accessToken };
      },
      scopes: ['profile'],
      tokenURL: 'https://provider.example.com/token',
    });
    const authorization = await provider.authorizationUrl({
      callbackURL: 'https://auth.example.com/example/callback',
      request: new Request('https://auth.example.com'),
      scopes: ['email'],
      state: 'state_123',
    });
    const identity = await provider.callback({
      callbackURL: 'https://auth.example.com/example/callback',
      code: 'code_123',
      request: new Request('https://auth.example.com'),
      state: 'state_123',
    });

    expect(authorization.searchParams.get('scope')).toBe('profile email');
    expect(authorization.searchParams.get('state')).toBe('state_123');
    expect(identity).toEqual({ id: 'access_token' });
    expect(requests).toEqual([
      {
        authorization: `Basic ${btoa('client_id:client_secret')}`,
        body: 'code=code_123&grant_type=authorization_code&redirect_uri=https%3A%2F%2Fauth.example.com%2Fexample%2Fcallback',
        url: 'https://provider.example.com/token',
      },
    ]);
  });
});
