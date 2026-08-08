import { describe, expect, it } from 'vitest';
import { discord } from './discord.js';
import { github } from './github.js';
import { twitch } from './twitch.js';
import { createProviderTestApp } from './test-utils.js';

const callbackInput = {
  callbackURL: 'https://auth.example.com/provider/callback',
  code: 'code_123',
  request: new Request('https://auth.example.com'),
  state: 'state_123',
};

describe('social providers', () => {
  it('loads a GitHub identity and verified primary email', async () => {
    const provider = github({
      clientId: 'client_id',
      clientSecret: 'client_secret',
      fetch: async (input) => {
        const url = String(input);

        if (url.includes('/access_token')) {
          return Response.json({ access_token: 'access_token' });
        }

        if (url.endsWith('/user/emails')) {
          return Response.json([
            {
              email: 'user@example.com',
              primary: true,
              verified: true,
            },
          ]);
        }

        return Response.json({ id: 123, login: 'octocat' });
      },
    });
    const app = createProviderTestApp(provider, { callback: callbackInput });
    const response = await app.request('/callback');

    await expect(response.json()).resolves.toMatchObject({
      email: 'user@example.com',
      emailVerified: true,
      id: '123',
      username: 'octocat',
    });
  });

  it('loads a GitHub Enterprise identity', async () => {
    const requests: string[] = [];
    const provider = github({
      clientId: 'client_id',
      clientSecret: 'client_secret',
      enterpriseURL: 'https://github.example.com',
      fetch: async (input) => {
        const url = String(input);

        requests.push(url);

        if (url === 'https://github.example.com/login/oauth/access_token') {
          return Response.json({ access_token: 'access_token' });
        }

        if (url === 'https://github.example.com/api/v3/user/emails') {
          return Response.json([]);
        }

        return Response.json({ id: 'enterprise-user', login: 'octocat' });
      },
    });
    const app = createProviderTestApp(provider, { callback: callbackInput });
    const response = await app.request('/callback');

    await expect(response.json()).resolves.toMatchObject({
      id: 'enterprise-user',
      username: 'octocat',
    });
    expect(requests).toEqual([
      'https://github.example.com/login/oauth/access_token',
      'https://github.example.com/api/v3/user',
      'https://github.example.com/api/v3/user/emails',
    ]);
  });

  it('loads a Discord identity', async () => {
    const provider = discord({
      clientId: 'client_id',
      clientSecret: 'client_secret',
      fetch: async (input) =>
        String(input).includes('/oauth2/token')
          ? Response.json({ access_token: 'access_token' })
          : Response.json({
              email: 'user@example.com',
              id: '123',
              username: 'discord-user',
              verified: true,
            }),
    });
    const app = createProviderTestApp(provider, { callback: callbackInput });
    const response = await app.request('/callback');

    await expect(response.json()).resolves.toMatchObject({
      email: 'user@example.com',
      emailVerified: true,
      id: '123',
      username: 'discord-user',
    });
  });

  it('loads a Twitch identity', async () => {
    const provider = twitch({
      clientId: 'client_id',
      clientSecret: 'client_secret',
      fetch: async (input) =>
        String(input).includes('/oauth2/token')
          ? Response.json({ access_token: 'access_token' })
          : Response.json({
              data: [
                {
                  display_name: 'Twitch User',
                  email: 'user@example.com',
                  id: '123',
                  login: 'twitch-user',
                },
              ],
            }),
    });
    const app = createProviderTestApp(provider, { callback: callbackInput });
    const response = await app.request('/callback');

    await expect(response.json()).resolves.toMatchObject({
      email: 'user@example.com',
      id: '123',
      name: 'Twitch User',
      username: 'twitch-user',
    });
  });
});
