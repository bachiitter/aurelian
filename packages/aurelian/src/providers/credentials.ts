import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ProviderIdentity } from '../profiles.js';
import type { MaybePromise, RequestProvider } from '../types.js';

export type CredentialsOptions<Schema extends StandardSchemaV1> = {
  schema: Schema;
  verify(input: {
    credentials: StandardSchemaV1.InferOutput<Schema>;
    request: Request;
  }): MaybePromise<ProviderIdentity | null>;
};

export function credentials<Schema extends StandardSchemaV1>(
  options: CredentialsOptions<Schema>,
): RequestProvider {
  return {
    async authenticate({ request }) {
      const value: unknown = await request.json().catch(() => null);
      const result = await options.schema['~standard'].validate(value);

      if (result.issues) {
        return null;
      }

      return options.verify({ credentials: result.value, request });
    },
    type: 'request',
  };
}
