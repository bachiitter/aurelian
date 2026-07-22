import { createExampleAuth } from './auth.js';
import type { Env } from './types.js';
export { AuthStorage } from './storage.js';

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');

    if (origin && origin !== env.APP_ORIGIN) {
      return new Response('Origin not allowed.', { status: 403 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-origin': env.APP_ORIGIN,
        },
        status: 204,
      });
    }

    let response: Response;

    if (url.pathname === '/') {
      response = Response.json({ name: 'Aurelian Cloudflare issuer' });
    } else if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) {
      response = await createExampleAuth(env).handler(request);
    } else if (url.pathname === '/demo/config') {
      response = Response.json({
        google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      });
    } else {
      response = new Response('Not found.', { status: 404 });
    }

    if (origin) {
      response.headers.set('access-control-allow-origin', origin);
      response.headers.set('vary', 'Origin');
    }

    return response;
  },
} satisfies ExportedHandler<Env>;
