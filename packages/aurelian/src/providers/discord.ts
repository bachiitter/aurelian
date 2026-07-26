import type { Provider } from '../types.js';
import { oauth } from './oauth.js';

export type DiscordOptions = {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  scopes?: string[];
};

export function discord(options: DiscordOptions): Provider {
  return oauth({
    authorizationURL: 'https://discord.com/oauth2/authorize',
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    fetch: options.fetch,
    async identify({ accessToken, fetch }) {
      const response = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const user: unknown = await response.json().catch(() => null);

      if (
        !response.ok ||
        typeof user !== 'object' ||
        user === null ||
        !('id' in user) ||
        typeof user.id !== 'string' ||
        !('username' in user) ||
        typeof user.username !== 'string'
      ) {
        throw new Error('discord_identity_failed');
      }

      const avatar =
        'avatar' in user && typeof user.avatar === 'string'
          ? user.avatar
          : null;

      return {
        avatarUrl: avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${avatar}.${avatar.startsWith('a_') ? 'gif' : 'png'}`
          : undefined,
        email:
          'email' in user && typeof user.email === 'string'
            ? user.email
            : undefined,
        emailVerified:
          'verified' in user && typeof user.verified === 'boolean'
            ? user.verified
            : undefined,
        id: user.id,
        name:
          'global_name' in user && typeof user.global_name === 'string'
            ? user.global_name
            : undefined,
        raw: user,
        username: user.username,
      };
    },
    scopes: ['identify', 'email', ...(options.scopes ?? [])],
    tokenURL: 'https://discord.com/api/oauth2/token',
  });
}
