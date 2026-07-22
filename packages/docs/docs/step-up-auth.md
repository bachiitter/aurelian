---
title: Step-up auth
description: Require fresh proof before sensitive application actions
---

## Model assurance

Add the authentication level and timestamp to a dedicated profile shape.

```ts
import { defineProfiles } from 'aurelian';
import { z } from 'zod';

const profiles = defineProfiles({
  user: z.object({
    authenticatedAt: z.number().int(),
    authenticationLevel: z.enum(['base', 'step-up']),
    id: z.string().min(1)
  })
});
```

The timestamp is a signed snapshot, not a server-side revocation check. Use a short access TTL for elevated sessions.

---

## Create a bound ticket

Verify the current access token before asking for another factor.

```ts
import { stepUpTickets } from '~/security/step-up-tickets.js';

type StepUpTicket = {
  userId: string;
};

async function createStepUpTicket(accessToken: string): Promise<{
  ticket: string;
}> {
  const current = await auth.verify(accessToken);

  if (!current.valid || current.profile.type !== 'user') {
    throw new Error('authentication_required');
  }

  const ticket = crypto.randomUUID();

  await stepUpTickets.set(
    ticket,
    JSON.stringify({
      userId: current.profile.properties.id
    } satisfies StepUpTicket),
    { ttl: 5 * 60 }
  );

  return { ticket };
}
```

`stepUpTickets` is application-owned storage with atomic `consume`. Bind any intended operation or risk context into the ticket when the proof should authorize only one action.

---

## Verify another factor

Consume the ticket and verify the factor for its bound user. This example uses an application-owned TOTP verifier with signature `(userId: string, code: string) => Promise<boolean>`.

```ts
import type { RequestProvider } from 'aurelian';
import {
  parseStepUpTicket,
  stepUpTickets,
  verifyTotp
} from '~/security/step-up.js';

async function readStepUpBody(request: Request): Promise<{
  code: string;
  ticket: string;
} | null> {
  const value: unknown = await request.json().catch(() => null);

  if (
    typeof value !== 'object' ||
    value === null ||
    !('code' in value) ||
    typeof value.code !== 'string' ||
    !('ticket' in value) ||
    typeof value.ticket !== 'string'
  ) {
    return null;
  }

  return { code: value.code, ticket: value.ticket };
}

export const stepUpProvider: RequestProvider = {
  async authenticate({ request }) {
    const body = await readStepUpBody(request);

    if (!body) {
      return null;
    }

    const storedStepUp = await stepUpTickets.consume(body.ticket)
    const stepUp = storedStepUp ? parseStepUpTicket(storedStepUp) : null

    if (!stepUp || !(await verifyTotp(stepUp.userId, body.code))) {
      return null;
    }

    return { id: stepUp.userId };
  },
  type: 'request'
};
```

The ticket is consumed even when the factor is wrong. Rate-limit ticket creation and factor attempts by account and network source.

---

## Resolve elevated access

Map only the step-up provider to the elevated level.

```ts
resolve({ profile, response }) {
  return profile('user', {
    authenticatedAt: Date.now(),
    authenticationLevel:
      response.provider === 'step-up' ? 'step-up' : 'base',
    id: response.data.id
  });
}
```

Register the provider under the exact `step-up` key in `createAuth`. Do not mark normal password or OAuth sessions as elevated unless policy explicitly treats them as fresh strong proof.

---

## Enforce freshness

Check level and age where the sensitive operation runs.

```ts
async function requireRecentStepUp(
  accessToken: string
): Promise<Response | null> {
  const result = await auth.verify(accessToken);

  if (!result.valid || result.profile.type !== 'user') {
    return new Response('Unauthorized', { status: 401 });
  }

  const profile = result.profile.properties;
  const isFresh = Date.now() - profile.authenticatedAt < 10 * 60 * 1000;

  if (profile.authenticationLevel !== 'step-up' || !isFresh) {
    return new Response('Step-up required', { status: 403 });
  }

  return null;
}
```

Frontend route guards are only presentation. Repeat this check in every protected server operation.

---

## Test assurance

Test expired, replayed, wrong-user, and wrong-factor tickets; base versus elevated profiles; freshness boundaries; and concurrent consumption. Assert that a failed factor cannot retry the same ticket.

Continue with [TOTP](/totp), [Passkeys](/passkeys), [Account linking](/account-linking), and [Security](/security).
