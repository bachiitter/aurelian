---
title: Service access
description: Authenticate jobs and backend integrations with narrow scope
---

## Define machine profiles

Use a separate profile type so APIs can distinguish services from users.

```ts
const profiles = defineProfiles({
  service: z.object({
    id: z.string().min(1),
    permissions: z.array(z.string())
  }),
  user: z.object({
    id: z.string().min(1)
  })
});
```

Import `defineProfiles` from `aurelian` and `z` from `zod`. The service ID becomes JWT `sub`; keep permissions narrow and task-specific.

---

## Verify credentials

Use a custom provider router for application-managed service credentials. Install `hono` directly before defining it.

```ts
import { Hono } from 'hono'
import type { Provider, ProviderEnvironment } from 'aurelian'
import { verifyServiceCredential } from '~/services/credentials.js'

const router = new Hono<ProviderEnvironment>()

router.post('/authenticate', async (context) => {
  const request = context.req.raw
  const authorization = request.headers.get('authorization')

  if (!authorization?.startsWith('Basic ')) {
    return context.var.aurelian.authenticate(null)
  }

  const service = await verifyServiceCredential(authorization.slice(6))

  if (!service) {
    return context.var.aurelian.authenticate(null)
  }

  return context.var.aurelian.authenticate({
    id: service.id,
    name: service.name
  })
})

export const serviceProvider: Provider = { router }
```

The explicit relative route becomes `/service/authenticate` when registered as `providers.service`. Calling `context.var.aurelian.authenticate` keeps profile resolution and token issuance centralized.

The application-owned verifier accepts the encoded credential string and returns `{ id: string; name: string } | null`. Decode strictly, compare a slow credential hash in constant time, rate-limit failures, and never log the header.

---

## Resolve current scope

Load permissions from the application database at issue and refresh.

```ts
import { createAuth } from 'aurelian';
import { getServiceById } from '~/services/repository.js';

const auth = createAuth({
  access: { audience: 'https://api.example.com' },
  issuer,
  profiles,
  providers: { service: serviceProvider },
  refresh: {
    async resolve({ profile }) {
      if (profile.type !== 'service') {
        return profile;
      }

      const service = await getServiceById(profile.properties.id);

      if (!service || service.revokedAt) {
        return null;
      }

      return {
        properties: {
          id: service.id,
          permissions: service.permissions
        },
        type: 'service'
      };
    }
  },
  async resolve({ profile, response }) {
    const service = await getServiceById(response.data.id);

    if (!service || service.revokedAt) {
      throw new Error('service_revoked');
    }

    return profile('service', {
      id: service.id,
      permissions: service.permissions
    });
  },
  signing,
  storage
});
```

The application-owned lookup returns `{ id: string; permissions: string[]; revokedAt: Date | null } | null`. Import signing, storage, and issuer from the server setup.

---

## Rotate credentials

Store only credential hashes and a public credential ID that selects the service record. Support overlapping credentials during planned rotation, then revoke the old one explicitly.

Credential revocation prevents new authentication immediately. Existing refresh chains stop on their next `refresh.resolve`, while existing access tokens remain valid until expiry.

---

## Issue one-off access

Backend jobs can receive a non-renewable access token through direct issue.

```ts
type Job = {
  id: string;
};

async function issueJobToken(job: Job): Promise<string> {
  const tokens = await auth.issue({
    profile: {
      properties: {
        id: job.id,
        permissions: ['reports:generate']
      },
      type: 'service'
    },
    provider: 'job-runner'
  });

  await auth.revoke({ refreshToken: tokens.refreshToken });

  return tokens.accessToken;
}
```

Fail issuance if immediate revocation fails. Set the access audience to the receiving API and keep the TTL close to the job duration.

---

## Enforce permissions

Require a service profile and validate the signed permission at the receiving API. Recheck current application policy for destructive actions that cannot wait for access-token expiry.

Do not let machine tokens enter user-only routes by default. Record service ID, session ID, token ID, action, and request ID in audit logs without recording the token.

---

## Test revocation

Test malformed credentials, wrong hashes, credential rotation, disabled services, permission changes on refresh, audience mismatch, one-off refresh rejection, and user/service route separation. Include concurrent requests during credential rollover.

Continue with [Sessions](/sessions), [Claims](/claims), [Security](/security), and [Impersonation](/impersonation).
