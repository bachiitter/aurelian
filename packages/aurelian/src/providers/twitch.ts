import type { OAuthProvider } from '../types.js';
import { oauth } from './oauth.js';

export type TwitchOptions = {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  scopes?: string[];
};

export function twitch(options: TwitchOptions): OAuthProvider {
  return oauth({
    authorizationURL: 'https://id.twitch.tv/oauth2/authorize',
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    fetch: options.fetch,
    async identify({ accessToken, fetch }) {
      const response = await fetch('https://api.twitch.tv/helix/users', {
        headers: {
          authorization: `Bearer ${accessToken}`,
          'client-id': options.clientId,
        },
      });
      const value: unknown = await response.json().catch(() => null);

      if (
        !response.ok ||
        typeof value !== 'object' ||
        value === null ||
        !('data' in value) ||
        !Array.isArray(value.data) ||
        value.data.length !== 1
      ) {
        throw new Error('twitch_identity_failed');
      }

      const user: unknown = value.data[0];

      if (
        typeof user !== 'object' ||
        user === null ||
        !('id' in user) ||
        typeof user.id !== 'string' ||
        !('login' in user) ||
        typeof user.login !== 'string'
      ) {
        throw new Error('twitch_identity_failed');
      }

      return {
        avatarUrl:
          'profile_image_url' in user &&
          typeof user.profile_image_url === 'string'
            ? user.profile_image_url
            : undefined,
        email:
          'email' in user && typeof user.email === 'string'
            ? user.email
            : undefined,
        id: user.id,
        name:
          'display_name' in user && typeof user.display_name === 'string'
            ? user.display_name
            : undefined,
        raw: user,
        username: user.login,
      };
    },
    scopes: ['user:read:email', ...(options.scopes ?? [])],
    tokenEndpointAuthMethod: 'client_secret_post',
    tokenURL: 'https://id.twitch.tv/oauth2/token',
  });
}
