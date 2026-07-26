import type { Provider } from '../types.js';
import { oauth } from './oauth.js';

const API_URL = 'https://api.github.com';

export type GitHubOptions = {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  scopes?: string[];
};

export function github(options: GitHubOptions): Provider {
  return oauth({
    authorizationURL: 'https://github.com/login/oauth/authorize',
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    fetch: options.fetch,
    async identify({ accessToken, fetch }) {
      const headers = {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${accessToken}`,
      };
      const userResponse = await fetch(`${API_URL}/user`, { headers });
      const user: unknown = await userResponse.json().catch(() => null);

      if (
        !userResponse.ok ||
        typeof user !== 'object' ||
        user === null ||
        !('id' in user) ||
        (typeof user.id !== 'number' && typeof user.id !== 'string') ||
        !('login' in user) ||
        typeof user.login !== 'string'
      ) {
        throw new Error('github_identity_failed');
      }

      const emailsResponse = await fetch(`${API_URL}/user/emails`, { headers });
      const emails: unknown = await emailsResponse.json().catch(() => null);
      let email =
        'email' in user && typeof user.email === 'string'
          ? user.email
          : undefined;
      let isEmailVerified: boolean | undefined;

      if (emailsResponse.ok && Array.isArray(emails)) {
        for (const item of emails) {
          const value: unknown = item;

          if (
            typeof value === 'object' &&
            value !== null &&
            'email' in value &&
            typeof value.email === 'string' &&
            'primary' in value &&
            value.primary === true &&
            'verified' in value &&
            typeof value.verified === 'boolean'
          ) {
            email = value.email;
            isEmailVerified = value.verified;
            break;
          }
        }
      }

      return {
        avatarUrl:
          'avatar_url' in user && typeof user.avatar_url === 'string'
            ? user.avatar_url
            : undefined,
        email,
        emailVerified: isEmailVerified,
        id: String(user.id),
        name:
          'name' in user && typeof user.name === 'string'
            ? user.name
            : undefined,
        raw: user,
        username: user.login,
      };
    },
    scopes: ['read:user', 'user:email', ...(options.scopes ?? [])],
    tokenEndpointAuthMethod: 'client_secret_post',
    tokenURL: 'https://github.com/login/oauth/access_token',
  });
}
