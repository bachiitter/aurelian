import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it } from 'vitest';
import { credentials } from './credentials.js';

const CredentialsSchema: StandardSchemaV1<
  unknown,
  { email: string; password: string }
> = {
  '~standard': {
    validate(value) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'email' in value &&
        typeof value.email === 'string' &&
        'password' in value &&
        typeof value.password === 'string'
      ) {
        return { value: { email: value.email, password: value.password } };
      }

      return { issues: [{ message: 'credentials_invalid' }] };
    },
    vendor: 'aurelian-test',
    version: 1,
  },
};

describe('credentials', () => {
  it('validates credentials before verification', async () => {
    const provider = credentials({
      schema: CredentialsSchema,
      verify({ credentials: value }) {
        return value.password === 'secret'
          ? { email: value.email, id: 'user_123' }
          : null;
      },
    });
    const request = new Request('https://auth.example.com', {
      body: JSON.stringify({ email: 'user@example.com', password: 'secret' }),
      method: 'POST',
    });

    await expect(provider.authenticate({ request })).resolves.toEqual({
      email: 'user@example.com',
      id: 'user_123',
    });
  });
});
