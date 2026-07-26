import { Hono } from 'hono';
import type { OAuthFlow, Provider, ProviderEnvironment } from '../types.js';

export function createOAuthProvider(flow: OAuthFlow): Provider {
  const router = new Hono<ProviderEnvironment>();

  router.get('/authorize', (context) =>
    context.var.aurelian.authorize(flow),
  );
  router.get('/callback', (context) => context.var.aurelian.callback(flow));

  return { router };
}
