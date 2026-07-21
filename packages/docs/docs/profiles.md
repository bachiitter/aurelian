---
title: Profiles
description: Validate typed snapshots before signing access tokens
---

## Define schemas

Pass Standard Schema validators to `defineProfiles`. Every output must be an object with a non-empty string `id` no longer than 512 characters.

```ts
import { defineProfiles } from 'aurelian';
import { z } from 'zod';

export const profiles = defineProfiles({
  admin: z.object({
    id: z.string().min(1),
    permissions: z.array(z.string())
  }),
  user: z.object({
    email: z.email(),
    id: z.string().min(1)
  })
});
```

Profile keys become a discriminated union of `{ type, properties }`. Aurelian validates before every initial issue and refresh issue.

---

## Return validated data

Validation currently checks the resolver output but keeps the original `properties` object in the profile. Do not rely on schema defaults, coercion, stripping, or transforms to change token contents.

Normalize and construct the exact data you want signed before calling `profile`. Reject missing provider fields instead of substituting empty strings.

---

## Resolve identities

Use `resolve` to join the provider key to application data and return the right profile type.

```ts
import { createAuth } from 'aurelian';
import { findProviderAccount } from '~/accounts.js';
import { profiles } from './profiles.js';

const auth = createAuth({
  issuer,
  profiles,
  providers,
  async resolve({ profile, response }) {
    const account = await findProviderAccount({
      provider: response.provider,
      providerAccountId: response.data.id
    });

    if (!account) {
      throw new Error('account_not_found');
    }

    if (account.kind === 'admin') {
      return profile('admin', {
        id: account.userId,
        permissions: account.permissions
      });
    }

    return profile('user', {
      email: account.email,
      id: account.userId
    });
  },
  signing,
  storage
});
```

`findProviderAccount` is application-owned and accepts `{ provider: string; providerAccountId: string }`. It returns `null` or `{ email: string; kind: 'user'; userId: string } | { kind: 'admin'; permissions: string[]; userId: string }`.

---

## Read provider data

`ProviderIdentity` always has `id`. It may include `avatarUrl`, `email`, `emailVerified`, `name`, `raw`, and `username`.

Use `raw: unknown` only when the resolver must inspect a provider-specific field, and validate it before use. Prefer `(provider, id)` as the stable lookup key instead of email.

---

## Refresh snapshots

Use `refresh.resolve` to replace mutable profile data while preserving its discriminant and ID.

```ts
refresh: {
  async resolve({ profile }) {
    if (profile.type !== 'admin') {
      return profile;
    }

    const admin = await getAdminById(profile.properties.id);

    if (!admin || admin.disabledAt) {
      return null;
    }

    return {
      properties: {
        id: admin.id,
        permissions: admin.permissions
      },
      type: 'admin'
    };
  }
}
```

Import the application-owned `getAdminById(id: string)` function from your data layer. Returning `null` ends that refresh chain; invalid returned data rejects issuance after the old token has been consumed.

---

## Test validation

Test every resolver branch with a valid identity, missing account, disabled account, wrong profile type, missing ID, and ID longer than 512 characters. Also test transformed schemas with the exact token payload to avoid assuming parsed output is retained.

Continue with [Account linking](/account-linking), [Sessions](/sessions), and the [profile API](/api#define-profiles).
