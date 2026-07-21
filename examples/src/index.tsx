import { serve } from '@hono/node-server';
import { createAuth, defineProfiles } from 'aurelian';
import { memoryStorage } from 'aurelian/storage/memory';
import { createServer } from 'vite';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import { z } from 'zod';

const issuer = 'http://localhost:3000/auth';
const clientOrigin = 'http://localhost:5173';
const passwords = new Map([['demo@example.com', 'password']]);
const profiles = defineProfiles({
  user: z.object({ id: z.string() }),
});
const keyPair = await generateKeyPair('ES256', { extractable: true });
const [privateKey, publicKey] = await Promise.all([
  exportPKCS8(keyPair.privateKey),
  exportSPKI(keyPair.publicKey),
]);
const auth = createAuth({
  resolve({ profile, response }) {
    return profile('user', { id: response.data.id });
  },
  issuer,
  profiles,
  providers: {
    password: {
      async authenticate({ request }) {
        const body: {
          email?: unknown;
          password?: unknown;
        } = await request.json();

        if (
          typeof body.email !== 'string' ||
          passwords.get(body.email) !== body.password
        ) {
          return null;
        }

        return {
          email: body.email,
          emailVerified: true,
          id: body.email,
        };
      },
      type: 'request',
    },
  },
  signing: { algorithm: 'ES256', privateKey, publicKey },
  storage: memoryStorage(),
});
const app = new Hono();

app.use(
  '/auth/*',
  cors({
    allowHeaders: ['Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    origin: clientOrigin,
  }),
);
app.mount('/auth', auth.handler);
app.get('/', (context) => context.redirect(clientOrigin));

serve({ fetch: app.fetch, port: 3000 });

const vite = await createServer({
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});

await vite.listen();
vite.printUrls();
