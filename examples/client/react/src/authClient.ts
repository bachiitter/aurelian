import { createClient } from 'aurelian/client';

export type UserProfile = {
  properties: { email: string; id: string };
  type: 'user';
};

export const authIssuer = (
  import.meta.env.VITE_AUTH_ISSUER ?? 'http://localhost:8787/auth'
).replace(/\/$/, '');

export const authClient = createClient<UserProfile>({
  issuer: authIssuer,
  redirectURI: `${location.origin}/auth/callback`,
});
