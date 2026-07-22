import { createHash } from '../crypto.js';
import type { ProviderIdentity } from '../profiles.js';
import type { StorageAdapter } from '../storage/types.js';
import type { MaybePromise, RequestProvider } from '../types.js';

const DEFAULT_TTL = 5 * 60;

export type CodeOptions = {
  identify(input: {
    identifier: string;
    request: Request;
  }): MaybePromise<ProviderIdentity | null>;
  send(input: {
    code: string;
    identifier: string;
    request: Request;
  }): MaybePromise<Response | void>;
  storage: StorageAdapter;
  ttl?: number;
};

export type CodeProvider = RequestProvider & {
  endpoints: {
    request: {
      handler(request: Request): MaybePromise<Response>;
      method: 'POST';
    };
  };
};

export function code(options: CodeOptions): CodeProvider {
  const ttl = options.ttl ?? DEFAULT_TTL;

  if (!Number.isSafeInteger(ttl) || ttl <= 0) {
    throw new RangeError('code.ttl must be a positive integer.');
  }

  return {
    async authenticate({ request }) {
      const body: unknown = await request.json().catch(() => null);

      if (
        typeof body !== 'object' ||
        body === null ||
        !('code' in body) ||
        typeof body.code !== 'string' ||
        !/^\d{6}$/.test(body.code) ||
        !('identifier' in body) ||
        typeof body.identifier !== 'string' ||
        body.identifier.length === 0 ||
        body.identifier.length > 512
      ) {
        return null;
      }

      const identifierHash = await createHash(body.identifier);
      const codeHash = await options.storage.consume(
        `aurelian:code:${identifierHash}`,
      );

      if (!codeHash || codeHash !== (await createHash(body.code))) {
        return null;
      }

      return options.identify({ identifier: body.identifier, request });
    },
    endpoints: {
      request: {
        async handler(request) {
          const body: unknown = await request.json().catch(() => null);

          if (
            typeof body !== 'object' ||
            body === null ||
            !('identifier' in body) ||
            typeof body.identifier !== 'string' ||
            body.identifier.length === 0 ||
            body.identifier.length > 512
          ) {
            return new Response('Identifier is required.', { status: 400 });
          }

          const values = crypto.getRandomValues(new Uint32Array(1));
          const value = String((values[0] ?? 0) % 1_000_000).padStart(6, '0');
          const identifierHash = await createHash(body.identifier);

          await options.storage.set(
            `aurelian:code:${identifierHash}`,
            await createHash(value),
            { ttl },
          );

          return (
            (await options.send({
              code: value,
              identifier: body.identifier,
              request,
            })) ?? new Response(null, { status: 204 })
          );
        },
        method: 'POST',
      },
    },
    type: 'request',
  };
}
