import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { authClient } from './authClient.js';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('root_element_missing');
}

const reactRoot = createRoot(root);

function renderApp(): void {
  if (location.pathname === '/auth/callback') {
    reactRoot.render(
      <main>
        <section className="panel callback" aria-live="polite">
          <p className="eyebrow">OAuth callback</p>
          <h1>Completing sign-in...</h1>
        </section>
      </main>,
    );

    void authClient
      .handleCallback()
      .then((tokens) => {
        localStorage.setItem('aurelian.accessToken', tokens.accessToken);
        localStorage.setItem('aurelian.refreshToken', tokens.refreshToken);
        location.replace('/');
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'callback_failed';

        reactRoot.render(
          <main>
            <section className="panel callback" aria-live="polite">
              <p className="eyebrow">OAuth callback</p>
              <h1>Sign-in failed.</h1>
              <pre>{JSON.stringify({ error: message }, null, 2)}</pre>
            </section>
          </main>,
        );
      });
    return;
  }

  reactRoot.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

renderApp();
