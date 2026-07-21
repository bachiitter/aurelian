---
title: Multiple accounts
description: Keep independent sessions on one client device
---

## Keep identities separate

Map each `(provider, providerAccountId)` pair to exactly one application user. Two accounts stay separate even when they share an email address.

Use the explicit flow in [Account linking](/account-linking) to point several provider records to one user. Never merge them during normal `resolve` execution.

---

## Resolve exact users

Load the provider-account row before returning a profile.

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
      throw new Error('account_not_found');
    }

    return profile('user', { id: account.userId });
  },
  signing,
  storage
});
```

The application-owned lookup returns `{ provider: string; providerAccountId: string; userId: string } | null`. Import the remaining configuration from [Setup](/setup).

---

## Define a vault

Store each complete token pair under the verified profile ID.

```ts
import type { TokenResponse } from 'aurelian';

export type AccountVault = {
  delete(userId: string): Promise<void>;
  get(userId: string): Promise<TokenResponse | null>;
  set(userId: string, tokens: TokenResponse): Promise<void>;
};
```

Implement this interface with protected native storage or server-side session data. Plain browser preferences and unencrypted local files are not appropriate for refresh tokens.

---

## Save a session

Verify the access token before choosing the vault key.

```ts
import { accountVault } from '~/account-vault.js';

const tokens = await authClient.handleCallback();
const result = await authClient.verify(tokens.accessToken);

if (!result.valid || result.profile.type !== 'user') {
  throw new Error('token_invalid');
}

await accountVault.set(result.profile.properties.id, tokens);
```

Do not use a user ID from callback query parameters or local UI state. The signed profile is the authority for the vault key.

---

## Switch locally

Changing accounts selects a stored pair; it does not mint a new session.

```ts
const selected = await accountVault.get(selectedUserId);

if (!selected) {
  throw new Error('account_session_missing');
}

const response = await fetch('/api/me', {
  headers: { authorization: `Bearer ${selected.accessToken}` }
});
```

Define `selectedUserId` from an account chooser populated by verified vault entries. Keep request caches and user-scoped state keyed by this same ID to prevent data bleed.

---

## Refresh one pair

Rotate only the selected account and replace its complete pair.

```ts
const next = await authClient.refresh({
  refreshToken: selected.refreshToken
});

await accountVault.set(selectedUserId, next);
```

Coordinate concurrent refreshes per account. A refresh failure for one pair should not remove another account's session.

---

## Remove one session

Revoke and delete only the chosen account.

```ts
await authClient.revoke({
  refreshToken: selected.refreshToken
});

await accountVault.delete(selectedUserId);
```

An issued access token remains valid until expiry. Clear user-scoped caches immediately after local removal.

---

## Keep browsers server-side

For browser applications, keep refresh tokens behind HTTP-only, `Secure`, appropriate `SameSite` cookies. Store account sessions under opaque server session IDs and switch an application-owned active-account pointer.

Protect account-switch routes against CSRF and verify that the selected account belongs to the current browser session. Do not send every stored refresh token to JavaScript.

---

## Test isolation

Test two users with the same email, linked providers, switching, per-account refresh, per-account sign-out, concurrent rotation, and cache separation. Assert that no token pair is ever stored under an unverified ID.

Continue with [Sessions](/sessions), [Client](/client), and [Account linking](/account-linking).
