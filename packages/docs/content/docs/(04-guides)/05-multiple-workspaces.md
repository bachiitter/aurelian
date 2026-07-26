---
title: Multiple workspaces
description: Scope sessions to one current organization membership
---

## Define scoped profiles

Use a base profile before selection and a workspace profile after selection.

```ts
import { defineProfiles } from 'aurelian';
import { z } from 'zod';

const profiles = defineProfiles({
  user: z.object({
    id: z.string().min(1)
  }),
  workspace: z.object({
    id: z.string().min(1),
    roles: z.array(z.string()),
    workspaceId: z.string().min(1)
  })
});
```

The profile `id` remains the user ID. `workspaceId` defines the active authorization boundary.

---

## List memberships

Verify the base session, then read current memberships from application storage.

```ts
import { getMemberships } from '~/memberships.js';

async function listWorkspaces(accessToken: string): Promise<Response> {
  const result = await auth.verify(accessToken);

  if (!result.valid || result.profile.type !== 'user') {
    return new Response('Unauthorized', { status: 401 });
  }

  const memberships = await getMemberships(result.profile.properties.id);

  return Response.json(
    memberships.map((membership) => ({
      id: membership.workspaceId,
      name: membership.workspaceName
    }))
  );
}
```

The application-owned function accepts a user ID and returns `Array<{ workspaceId: string; workspaceName: string }>`. Never accept a trusted membership list from the client.

---

## Issue scoped access

Validate membership again when the user selects a workspace.

```ts
import { getMembership } from '~/memberships.js';

async function switchWorkspace(input: {
  accessToken: string;
  workspaceId: string;
}): Promise<Response> {
  const current = await auth.verify(input.accessToken);

  if (!current.valid || current.profile.type !== 'user') {
    return new Response('Unauthorized', { status: 401 });
  }

  const userId = current.profile.properties.id;
  const membership = await getMembership(userId, input.workspaceId);

  if (!membership) {
    return new Response('Forbidden', { status: 403 });
  }

  const tokens = await auth.issue({
    profile: {
      properties: {
        id: userId,
        roles: membership.roles,
        workspaceId: membership.workspaceId
      },
      type: 'workspace'
    },
    provider: 'workspace-switch'
  });

  return Response.json(tokens);
}
```

`getMembership(userId, workspaceId)` returns `{ roles: string[]; workspaceId: string } | null`. Protect this application route against CSRF when it uses cookie authentication.

---

## Recheck during refresh

Reject rotation after membership removal and reload changed roles.

```ts
refresh: {
  async resolve({ profile }) {
    if (profile.type !== 'workspace') {
      return profile;
    }

    const membership = await getMembership(
      profile.properties.id,
      profile.properties.workspaceId
    );

    if (!membership) {
      return null;
    }

    return {
      properties: {
        id: profile.properties.id,
        roles: membership.roles,
        workspaceId: membership.workspaceId
      },
      type: 'workspace'
    };
  }
}
```

Place this block inside `createAuth` and import the same application-owned lookup. Returning `null` ends that workspace session without touching other refresh chains.

---

## Enforce signed scope

Read workspace identity and roles from the verified profile.

```ts
type CreateDocumentInput = {
  title: string;
};

async function handleCreateDocument(
  accessToken: string,
  input: CreateDocumentInput
): Promise<Response> {
  const result = await auth.verify(accessToken);

  if (!result.valid || result.profile.type !== 'workspace') {
    return new Response('Workspace session required', { status: 403 });
  }

  if (!result.profile.properties.roles.includes('documents:write')) {
    return new Response('Forbidden', { status: 403 });
  }

  const document = await createDocument({
    input,
    workspaceId: result.profile.properties.workspaceId
  });

  return Response.json(document);
}
```

Import the application-owned `createDocument` function with input `{ input: CreateDocumentInput; workspaceId: string }`. If a route also contains a workspace ID, require an exact match with the signed value.

---

## Test boundaries

Test no membership, removed membership, changed roles, wrong profile type, URL/profile mismatch, and two simultaneous workspace sessions. Verify that refresh never trusts a role or workspace ID supplied by the client.

Continue with [Claims](/claims), [Sessions](/sessions), and [Security](/security).
