import { createAuth, defineProfiles } from 'aurelian';
import type { Auth, ProfilePayload, Provider } from 'aurelian';
import { code } from 'aurelian/providers/code';
import { credentials } from 'aurelian/providers/credentials';
import { google } from 'aurelian/providers/google';
import { passkey } from 'aurelian/providers/passkey';
import { z } from 'zod';
import { durableObjectStorage } from './storage.js';
import type { Env } from './types.js';

const DEMO_EMAIL = 'demo@example.com';

const profiles = defineProfiles({
  user: z.object({
    email: z.email(),
    id: z.string().min(1),
  }),
});

export function createExampleAuth(env: Env): Auth<ProfilePayload<typeof profiles>> {
  const appURL = new URL(env.APP_ORIGIN);
  const records = env.AUTH_STORAGE.getByName('aurelian-auth');
  const storage = durableObjectStorage(env.AUTH_STORAGE);
  const googleProvider: Record<string, Provider> =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: google({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          }),
        }
      : {};

  const auth: Auth<ProfilePayload<typeof profiles>> = createAuth({
    issuer: env.AUTH_ISSUER,
    onError(error, context) {
      console.error({
        error: error instanceof Error ? error.stack : String(error),
        requestId: context.requestId,
        timestamp: new Date().toISOString(),
      });
    },
    profiles,
    providers: {
      code: code({
        identify({ identifier }) {
          return identifier === DEMO_EMAIL
            ? {
                email: identifier,
                emailVerified: true,
                id: identifier,
              }
            : null;
        },
        send({ code, request }) {
          const hostname = new URL(request.url).hostname;

          return hostname === 'localhost' || hostname === '127.0.0.1'
            ? Response.json({
                code,
                delivery: 'development-only-response',
                warning: 'Send this code with an email provider in production.',
              })
            : new Response('Not found.', { status: 404 });
        },
        storage,
      }),
      passkey: passkey({
        async handle(event) {
          if (event.type === 'credential') {
            const credential = await records.getCredential(
              `application:passkey:${event.id}`,
            );

            return credential
              ? {
                  ...credential,
                  identity: {
                    email: credential.email,
                    emailVerified: true,
                    id: credential.userId,
                  },
                  publicKey: new Uint8Array(credential.publicKey),
                }
              : null;
          }

          if (event.type === 'credential-created') {
            if (!event.identity.email) {
              throw new Error('email_required');
            }

            await records.set(
              `application:passkey:${event.credential.id}`,
              {
                ...event.credential,
                email: event.identity.email,
                publicKey: [...event.credential.publicKey],
                userId: event.identity.id,
              },
              365 * 24 * 60 * 60,
            );
            return;
          }

          if (event.type === 'counter-update') {
            return records.updateCounter(
              `application:passkey:${event.credentialId}`,
              event.credentialId,
              event.currentCounter,
              event.newCounter,
            );
          }

          const authorization = event.request.headers.get('authorization');
          const session = authorization?.startsWith('Bearer ')
            ? await auth.verify(authorization.slice(7))
            : null;

          return session?.valid
            ? {
                identity: {
                  email: session.profile.properties.email,
                  emailVerified: true,
                  id: session.profile.properties.id,
                },
                name: session.profile.properties.email,
              }
            : null;
        },
        origin: appURL.origin,
        rpID: appURL.hostname,
        rpName: 'Aurelian Example',
        storage,
      }),
      credentials: credentials({
        schema: z.object({
          email: z.email(),
          password: z.string().min(1),
        }),
        verify({ credentials: value }) {
          return value.email === DEMO_EMAIL &&
            value.password === env.DEMO_PASSWORD
            ? {
                email: value.email,
                emailVerified: true,
                id: value.email,
              }
            : null;
        },
      }),
      ...googleProvider,
    },
    resolve({ profile, response }) {
      if (!response.data.email) {
        throw new Error('email_required');
      }

      return profile('user', {
        email: response.data.email,
        id: response.data.id,
      });
    },
    signing: {
      algorithm: 'ES256',
      privateKey: env.AUTH_PRIVATE_KEY,
      publicKey: env.AUTH_PUBLIC_KEY,
    },
    storage,
  });

  return auth;
}
