import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../storage/memory.js';
import { code } from './code.js';

describe('code', () => {
  it('creates and consumes one-time codes', async () => {
    const deliveredCodes: string[] = [];
    const provider = code({
      identify({ identifier }) {
        return { email: identifier, emailVerified: true, id: identifier };
      },
      send({ code: value }) {
        deliveredCodes.push(value);
      },
      storage: memoryStorage(),
    });
    const identifier = 'user@example.com';

    await provider.endpoints.request.handler(
      new Request('https://auth.example.com', {
        body: JSON.stringify({ identifier }),
        method: 'POST',
      }),
    );
    const value = deliveredCodes[0];

    if (!value) {
      throw new Error('code_not_delivered');
    }

    const request = new Request('https://auth.example.com', {
      body: JSON.stringify({ code: value, identifier }),
      method: 'POST',
    });

    expect(value).toMatch(/^\d{6}$/);
    await expect(provider.authenticate({ request })).resolves.toEqual({
      email: identifier,
      emailVerified: true,
      id: identifier,
    });
    await expect(
      provider.authenticate({
        request: new Request('https://auth.example.com', {
          body: JSON.stringify({ code: value, identifier }),
          method: 'POST',
        }),
      }),
    ).resolves.toBeNull();
  });

  it('consumes the code after an incorrect attempt', async () => {
    const deliveredCodes: string[] = [];
    const provider = code({
      identify({ identifier }) {
        return { id: identifier };
      },
      send({ code: value }) {
        deliveredCodes.push(value);
      },
      storage: memoryStorage(),
    });
    const identifier = '+15555550123';

    await provider.endpoints.request.handler(
      new Request('https://auth.example.com', {
        body: JSON.stringify({ identifier }),
        method: 'POST',
      }),
    );
    const value = deliveredCodes[0];

    if (!value) {
      throw new Error('code_not_delivered');
    }

    const incorrectCode = value === '000000' ? '111111' : '000000';

    await expect(
      provider.authenticate({
        request: new Request('https://auth.example.com', {
          body: JSON.stringify({ code: incorrectCode, identifier }),
          method: 'POST',
        }),
      }),
    ).resolves.toBeNull();
    await expect(
      provider.authenticate({
        request: new Request('https://auth.example.com', {
          body: JSON.stringify({ code: value, identifier }),
          method: 'POST',
        }),
      }),
    ).resolves.toBeNull();
  });
});
