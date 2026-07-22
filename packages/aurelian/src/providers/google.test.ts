import { afterEach, describe, expect, it, vi } from 'vitest';
import { google } from './google.js';

const CALLBACK_URL = 'https://auth.example.com/google/callback';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('google', () => {
  it('builds an authorization URL with required and requested scopes', () => {
    const provider = google({
      clientId: 'google-client',
      clientSecret: 'google-secret',
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
    const url = provider.authorizationUrl({
      callbackURL: CALLBACK_URL,
      request: new Request('https://auth.example.com/google/authorize'),
      scopes: ['email', 'https://www.googleapis.com/auth/drive.file'],
      state: 'upstream-state',
    });

    expect(url).toBeInstanceOf(URL);

    if (!(url instanceof URL)) {
      throw new Error('expected_synchronous_authorization_url');
    }

    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'google-client',
      redirect_uri: CALLBACK_URL,
      response_type: 'code',
      scope:
        'openid email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.file',
      state: 'upstream-state',
    });
  });

  it('exchanges the code and normalizes the OIDC UserInfo response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: 'google-access' }))
      .mockResolvedValueOnce(
        Response.json({
          email: 'person@example.com',
          email_verified: true,
          name: 'Example Person',
          picture: 'https://example.com/avatar.png',
          sub: 'google-user-id',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const provider = google({
      clientId: 'google-client',
      clientSecret: 'google-secret',
    });

    const identity = await provider.callback({
      callbackURL: CALLBACK_URL,
      code: 'authorization-code',
      request: new Request(`${CALLBACK_URL}?code=authorization-code`),
      state: 'upstream-state',
    });

    expect(identity).toEqual({
      avatarUrl: 'https://example.com/avatar.png',
      email: 'person@example.com',
      emailVerified: true,
      id: 'google-user-id',
      name: 'Example Person',
      raw: {
        email: 'person@example.com',
        email_verified: true,
        name: 'Example Person',
        picture: 'https://example.com/avatar.png',
        sub: 'google-user-id',
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' }),
    );
    const tokenRequest = fetchMock.mock.calls[0]?.[1];

    expect(String(tokenRequest?.body)).toBe(
      'client_id=google-client&client_secret=google-secret&code=authorization-code&grant_type=authorization_code&redirect_uri=https%3A%2F%2Fauth.example.com%2Fgoogle%2Fcallback',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://openidconnect.googleapis.com/v1/userinfo',
      { headers: { authorization: 'Bearer google-access' } },
    );
  });

  it('rejects failed or malformed upstream responses', async () => {
    const provider = google({
      clientId: 'google-client',
      clientSecret: 'google-secret',
    });
    const callbackInput = {
      callbackURL: CALLBACK_URL,
      code: 'authorization-code',
      request: new Request(`${CALLBACK_URL}?code=authorization-code`),
      state: 'upstream-state',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 400 })),
    );
    await expect(provider.callback(callbackInput)).rejects.toThrow(
      'google_token_exchange_failed',
    );

    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ access_token: 'google-access' }))
        .mockResolvedValueOnce(Response.json({ email: 'missing-sub@example.com' })),
    );
    await expect(provider.callback(callbackInput)).rejects.toThrow(
      'google_identity_failed',
    );
  });

  it('requires client credentials', () => {
    expect(() => google({ clientId: '', clientSecret: 'secret' })).toThrow(
      'google_client_id_required',
    );
    expect(() => google({ clientId: 'client', clientSecret: '' })).toThrow(
      'google_client_secret_required',
    );
  });
});
