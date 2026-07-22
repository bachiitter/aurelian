import { describe, expect, it } from 'vitest';
import { discord } from './discord.js';
import { github } from './github.js';
import { twitch } from './twitch.js';

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

    await expect(provider.callback(callbackInput)).resolves.toMatchObject({
      email: 'user@example.com',
      emailVerified: true,
      id: '123',
      username: 'octocat',
    });
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

    await expect(provider.callback(callbackInput)).resolves.toMatchObject({
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

    await expect(provider.callback(callbackInput)).resolves.toMatchObject({
      email: 'user@example.com',
      id: '123',
      name: 'Twitch User',
      username: 'twitch-user',
    });
  });
});
