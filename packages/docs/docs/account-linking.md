---
title: Account linking
description: Bind provider identities to one application user
---

## Model provider accounts

Store provider identities separately from users and enforce one owner for each pair.

```ts
type ProviderAccount = {
  provider: string;
  providerAccountId: string;
  userId: string;
};
```

Add a unique constraint on `(provider, providerAccountId)`. Do not use email as the primary key because addresses can be missing, unverified, changed, or reused.

---

## Resolve existing links

Look up the exact pair received from Aurelian.

```ts
import { createAuth } from 'aurelian';
import { findProviderAccount } from '~/accounts.js';

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
      throw new Error('account_not_linked');
    }

    return profile('user', { id: account.userId });
  },
  signing,
  storage
});
```

Import the remaining configuration from [Setup](/setup). The application-owned lookup accepts the two-string object and returns `ProviderAccount | null`.

---

## Require recent authentication

Start linking only from a current user session with fresh proof. Create an application-owned ticket after password, passkey, or another approved reauthentication method succeeds.

```ts
type ReauthenticationTicket = {
  userId: string;
};

type LinkIntent = {
  provider: string;
  userId: string;
};

async function createLinkIntent(input: {
  accessToken: string;
  provider: string;
  reauthenticationTicket: string;
}): Promise<{ state: string }> {
  const current = await auth.verify(input.accessToken);

  if (!current.valid || current.profile.type !== 'user') {
    throw new Error('authentication_required');
  }

  const confirmation = await reauthenticationTickets.consume<
    ReauthenticationTicket
  >(input.reauthenticationTicket);

  if (
    !confirmation ||
    confirmation.userId !== current.profile.properties.id
  ) {
    throw new Error('recent_authentication_required');
  }

  const state = crypto.randomUUID();

  await linkIntents.set(
    state,
    {
      provider: input.provider,
      userId: current.profile.properties.id
    } satisfies LinkIntent,
    { ttl: 10 * 60 }
  );

  return { state };
}
```

`reauthenticationTickets` and `linkIntents` are application-owned `StorageAdapter` instances imported from your security module. Keep this dedicated linking state separate from Aurelian's normal sign-in state.

---

## Commit the mapping

After a dedicated provider callback verifies `ProviderIdentity`, consume the intent and create the link in one transaction.

```ts
import type { ProviderIdentity } from 'aurelian';
import { database, linkIntents } from '~/account-linking.js';

async function commitAccountLink(input: {
  identity: ProviderIdentity;
  provider: string;
  state: string;
}): Promise<void> {
  const intent = await linkIntents.consume<LinkIntent>(input.state);

  if (!intent || intent.provider !== input.provider) {
    throw new Error('link_intent_invalid');
  }

  await database.linkProviderAccountUnique({
    provider: input.provider,
    providerAccountId: input.identity.id,
    userId: intent.userId
  });
}
```

The application-owned database method must atomically reject an existing pair owned by another user. Map that conflict to a generic user-facing error without disclosing the other account.

---

## Restrict automatic links

Do not link accounts solely because verified emails match. If product policy permits it for selected providers, still require a current session, recent proof, a fresh provider ceremony, and a transactional uniqueness check.

Keep registration, invitations, and organization policy in application code. A provider proves control of an identity; it does not grant a user record or membership.

---

## Issue after onboarding

Call `auth.issue` only after application-owned onboarding or invitation checks finish.

```ts
async function issueOnboardingSession(userId: string): Promise<TokenResponse> {
  return auth.issue({
    profile: {
      properties: { id: userId },
      type: 'user'
    },
    provider: 'invite'
  });
}
```

Import `TokenResponse` from `aurelian` and `auth` from your server module. Direct issue still validates the profile and creates a normal renewable refresh session.

---

## Test conflicts

Test missing links, stale and replayed intents, provider mismatch, another user's existing link, concurrent commits, recent-auth expiry, and database rollback. Assert that only one user can own a provider pair.

Continue with [Multiple accounts](/multiple-accounts), [Step-up auth](/step-up-auth), and [Security](/security).
