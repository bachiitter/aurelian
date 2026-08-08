import type { Provider } from '../types.js';
import { oauth } from './oauth.js';

const API_URL = 'https://api.github.com';
const WEB_URL = 'https://github.com';

export type GitHubOptions = {
  apiURL?: string;
  authorizationURL?: string;
  clientId: string;
  clientSecret: string;
  enterpriseURL?: string;
  fetch?: typeof fetch;
  scopes?: string[];
  tokenURL?: string;
};

export function github(options: GitHubOptions): Provider {
  const webURL = options.enterpriseURL?.replace(/\/$/, '') ?? WEB_URL;
  const apiURL = options.apiURL?.replace(/\/$/, '') ?? (options.enterpriseURL ? `${webURL}/api/v3` : API_URL);

  return oauth({
    authorizationURL: options.authorizationURL ?? `${webURL}/login/oauth/authorize`,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    fetch: options.fetch,
    async identify({ accessToken, fetch }) {
      const headers = {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${accessToken}`,
      };
      const userResponse = await fetch(`${apiURL}/user`, { headers });
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

      const emailsResponse = await fetch(`${apiURL}/user/emails`, { headers });
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
    tokenURL: options.tokenURL ?? `${webURL}/login/oauth/access_token`,
  });
}
