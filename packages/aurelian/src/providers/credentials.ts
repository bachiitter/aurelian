import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Hono } from 'hono';
import type { ProviderIdentity } from '../profiles.js';
import type {
  MaybePromise,
  Provider,
  ProviderEnvironment,
} from '../types.js';

export type CredentialsOptions<Schema extends StandardSchemaV1> = {
  schema: Schema;
  verify(input: {
    credentials: StandardSchemaV1.InferOutput<Schema>;
    request: Request;
  }): MaybePromise<ProviderIdentity | null>;
};

export function credentials<Schema extends StandardSchemaV1>(
  options: CredentialsOptions<Schema>,
): Provider {
  const router = new Hono<ProviderEnvironment>();

  router.post('/authenticate', async (context) => {
    const request = context.req.raw;
    const value: unknown = await request.json().catch(() => null);
    const result = await options.schema['~standard'].validate(value);

    if (result.issues) {
      return context.var.aurelian.authenticate(null);
    }

    return context.var.aurelian.authenticate(
      options.verify({ credentials: result.value, request }),
    );
  });

  return { router };
}
