---
title: Impersonation
description: Issue short traceable access for support workflows
---

## Define a distinct profile

Keep impersonated access separate from a normal user profile and sign both actor and target identifiers.

```ts
const profiles = defineProfiles({
  impersonation: z.object({
    actorId: z.string().min(1),
    auditEventId: z.string().min(1),
    id: z.string().min(1)
  }),
  user: z.object({
    id: z.string().min(1)
  })
});
```

Import `defineProfiles` from `aurelian` and `z` from `zod`. The impersonation profile ID is the target and becomes JWT `sub`; `actorId` records who initiated access.

---

## Authorize the actor

Require permission, recent authentication, a valid target, and a bounded reason before issuance.

```ts
import type { TokenResponse } from 'aurelian';
import {
  auditLog,
  getUserById,
  requireCurrentSupportUser
} from '~/support/impersonation.js';

async function startImpersonation(input: {
  reason: string;
  request: Request;
  targetUserId: string;
}): Promise<{ accessToken: string }> {
  const actor = await requireCurrentSupportUser(input.request);

  if (!actor.permissions.includes('users:impersonate')) {
    throw new Error('impersonation_forbidden');
  }

  if (Date.now() - actor.authenticatedAt > 5 * 60 * 1000) {
    throw new Error('recent_authentication_required');
  }

  const target = await getUserById(input.targetUserId);
  const reason = input.reason.trim();

  if (!target || reason.length < 10 || reason.length > 500) {
    throw new Error('impersonation_request_invalid');
  }

  const auditEvent = await auditLog.create({
    actorId: actor.id,
    event: 'impersonation.started',
    reason,
    targetUserId: target.id
  });
  const tokens: TokenResponse = await auth.issue({
    profile: {
      properties: {
        actorId: actor.id,
        auditEventId: auditEvent.id,
        id: target.id
      },
      type: 'impersonation'
    },
    provider: 'support-console'
  });

  await auth.revoke({ refreshToken: tokens.refreshToken });

  return { accessToken: tokens.accessToken };
}
```

The application-owned guard returns `{ authenticatedAt: number; id: string; permissions: string[] }`; `getUserById` returns `{ id: string } | null`. `auditLog.create` must persist before token issuance and return `{ id: string }`.

---

## Make access non-renewable

`auth.issue` always creates a token pair, so revoke its refresh token before returning only the access token. If revocation fails, fail the request and alert operators rather than returning renewable impersonation credentials.

The access token remains valid until `access.ttl` expires. Configure a short global TTL or run a separate short-lived auth instance if impersonation needs a shorter lifetime than normal sessions.

---

## Enforce boundaries

Allow impersonated profiles only on routes that support them and write per-request audit data.

```ts
async function recordImpersonatedRequest(
  accessToken: string,
  request: Request
): Promise<Response | null> {
  const result = await auth.verify(accessToken);

  if (!result.valid) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (result.profile.type === 'impersonation') {
    await auditLog.write({
      actorId: result.profile.properties.actorId,
      auditEventId: result.profile.properties.auditEventId,
      event: 'impersonation.request',
      method: request.method,
      path: new URL(request.url).pathname,
      targetUserId: result.profile.properties.id
    });
  }

  return null;
}
```

The application-owned audit writer accepts the shown non-sensitive fields. Block password, factor, billing, credential, export, and further impersonation actions for this profile type.

---

## Show active access

Display a persistent banner with the target and a clear exit action. Never make an impersonated session visually indistinguishable from the actor's normal session.

Keep the actor's original token pair separate and restore it only after discarding the impersonation access token. Do not place either token in a URL.

---

## Test auditability

Test permission denial, stale authentication, invalid targets, bounded reasons, audit-write failure, revoke failure, profile-based action blocks, access expiry, and absence of a usable refresh token. Correlate start and request events by `auditEventId`.

Continue with [Step-up auth](/step-up-auth), [Security](/security), and [Claims](/claims).
