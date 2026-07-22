import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { App } from './App.js';
import { authClient } from './authClient.js';

const rootRoute = createRootRoute({ component: Outlet });
const indexRoute = createRoute({
  component: App,
  getParentRoute: () => rootRoute,
  path: '/',
});
const callbackRoute = createRoute({
  errorComponent: ({ error }) => (
    <main>
      <section className="panel callback" aria-live="polite">
        <p className="eyebrow">OAuth callback</p>
        <h1>Sign-in failed.</h1>
        <pre>{JSON.stringify({ error: error.message }, null, 2)}</pre>
      </section>
    </main>
  ),
  getParentRoute: () => rootRoute,
  loader: async () => {
    const tokens = await authClient.handleCallback({ url: location.href });
        localStorage.setItem('aurelian.accessToken', tokens.accessToken);
        localStorage.setItem('aurelian.refreshToken', tokens.refreshToken);
    throw redirect({ to: '/' });
  },
  path: '/auth/callback',
  pendingComponent: () => (
    <main>
      <section className="panel callback" aria-live="polite">
        <p className="eyebrow">OAuth callback</p>
        <h1>Completing sign-in…</h1>
      </section>
    </main>
  ),
});

const routeTree = rootRoute.addChildren([indexRoute, callbackRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
