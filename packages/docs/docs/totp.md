---
title: TOTP
description: Add replay-resistant authenticator codes to request providers
---

## Install verification

Aurelian does not generate or verify TOTP. This guide uses OTPAuth for the factor and Aurelian for session issuance.

```bash
pnpm add otpauth
```

Encrypt TOTP secrets at rest because verification requires the original secret. Hash recovery codes separately because they should be compared once and consumed.

---

## Define application records

Store pending enrollment separately from the active factor.

```ts
type PendingTotpEnrollment = {
  encryptedSecret: string;
  expiresAt: Date;
  userId: string;
};

type TotpFactor = {
  decryptedSecret: string;
  id: string;
  lastCounter: number;
  userId: string;
};
```

Application storage must enforce one active factor per user unless the product intentionally supports more. Never return `decryptedSecret` outside the server factor module.

---

## Begin enrollment

Require a recent authenticated session, generate a secret, and store only its encrypted form.

```ts
import * as OTPAuth from 'otpauth';
import {
  encryptSecret,
  pendingTotpEnrollments,
  requireRecentlyAuthenticatedUser
} from '~/security/totp.js';

async function beginTotpEnrollment(request: Request): Promise<Response> {
  const user = await requireRecentlyAuthenticatedUser(request);
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    issuer: 'Example',
    label: user.email,
    period: 30,
    secret
  });

  await pendingTotpEnrollments.upsert({
    encryptedSecret: await encryptSecret(secret.base32),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    userId: user.id
  });

  return Response.json({ uri: totp.toString() });
}
```

The application-owned auth guard returns `{ email: string; id: string }`; `encryptSecret` returns an authenticated ciphertext string. Render the URI as a QR code on a trusted enrollment page.

---

## Confirm possession

Verify one code before moving the pending secret to the active record.

```ts
import * as OTPAuth from 'otpauth';
import {
  activateTotpFactor,
  decryptSecret,
  pendingTotpEnrollments,
  requireRecentlyAuthenticatedUser
} from '~/security/totp.js';

async function confirmTotpEnrollment(
  request: Request,
  code: string
): Promise<Response> {
  const user = await requireRecentlyAuthenticatedUser(request);
  const pending = await pendingTotpEnrollments.findByUserId(user.id);

  if (!pending || pending.expiresAt.getTime() <= Date.now()) {
    return new Response('Enrollment expired', { status: 400 });
  }

  const secret = await decryptSecret(pending.encryptedSecret);
  const timestamp = Date.now();
  const totp = new OTPAuth.TOTP({ secret });
  const delta = totp.validate({ timestamp, token: code, window: 1 });

  if (delta === null) {
    return new Response('Invalid code', { status: 400 });
  }

  await activateTotpFactor({
    encryptedSecret: pending.encryptedSecret,
    lastCounter: Math.floor(timestamp / 1000 / 30) + delta,
    userId: user.id
  });

  return new Response(null, { status: 204 });
}
```

`activateTotpFactor` must insert the factor and delete the pending record in one transaction. Rate-limit confirmations and reject malformed six-digit strings before verification.

---

## Bind the first factor

After password or another first factor succeeds, create a short-lived opaque ticket containing only the verified user ID.

```ts
type TotpLoginTicket = {
  userId: string;
};

async function createTotpLoginTicket(input: {
  email: string;
  password: string;
}): Promise<{ ticket: string } | null> {
  const user = await verifyUserPassword(input.email, input.password);

  if (!user) {
    return null;
  }

  const ticket = crypto.randomUUID();

  await loginTickets.set(
    ticket,
    JSON.stringify({ userId: user.id } satisfies TotpLoginTicket),
    { ttl: 5 * 60 }
  );

  return { ticket };
}
```

Import application-owned `verifyUserPassword` and `loginTickets` from the factor module. The ticket store must consume atomically so first-factor proof cannot be replayed.

---

## Verify the code

Consume the ticket, validate a narrow clock window, then update the accepted counter conditionally.

```ts
import * as OTPAuth from 'otpauth';
import type { RequestProvider } from 'aurelian';
import {
  getTotpFactor,
  loginTickets,
  parseTotpLoginTicket,
  parseTotpRequest,
  storeCounterIfGreater
} from '~/security/totp.js';

export const totpProvider: RequestProvider = {
  async authenticate({ request }) {
    const body = await parseTotpRequest(request);

    if (!body) {
      return null;
    }

    const storedLogin = await loginTickets.consume(body.ticket)
    const login = storedLogin ? parseTotpLoginTicket(storedLogin) : null

    if (!login) {
      return null;
    }

    const factor = await getTotpFactor(login.userId);

    if (!factor) {
      return null;
    }

    const timestamp = Date.now();
    const totp = new OTPAuth.TOTP({
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: factor.decryptedSecret
    });
    const delta = totp.validate({
      timestamp,
      token: body.code,
      window: 1
    });

    if (delta === null) {
      return null;
    }

    const counter = Math.floor(timestamp / 1000 / 30) + delta;
    const isFresh = await storeCounterIfGreater(factor.id, counter);

    return isFresh ? { id: login.userId } : null;
  },
  type: 'request'
};
```

`parseTotpRequest` returns `{ code: string; ticket: string } | null`, `getTotpFactor` returns `TotpFactor | null`, and `storeCounterIfGreater` performs one conditional database update. A window of `1` tolerates modest clock drift while the counter check prevents reusing an accepted step.

---

## Issue the session

Register `totpProvider` under `totp`, then resolve its identity to the same application user profile as other sign-in methods.

```ts
const providers = { totp: totpProvider };

const auth = createAuth({
  issuer,
  profiles,
  providers,
  resolve({ profile, response }) {
    return profile('user', { id: response.data.id });
  },
  signing,
  storage
});
```

Import `createAuth` and the setup config in the server module. The client submits `{ code, ticket }` with `authClient.authenticate('totp', body)`.

---

## Prepare recovery

Generate high-entropy single-use recovery codes during enrollment, show them once, and store only slow hashes. Consume one atomically and regenerate the full set after any recovery.

Notify the user when a factor or recovery set changes. Require recent proof to disable TOTP and invalidate outstanding enrollment or login tickets.

---

## Test replay defense

Test expired enrollment, wrong code, clock-window edges, reused login tickets, concurrent code submissions, lower or equal counters, recovery-code reuse, and factor removal. Use a controlled clock rather than waiting for real 30-second windows.

Continue with [Step-up auth](/step-up-auth) and [Security](/security).
