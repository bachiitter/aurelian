import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { TokenResponse } from 'aurelian/client';
import { useState } from 'react';
import type { SyntheticEvent } from 'react';
import { authClient, authIssuer } from './authClient.js';

const DEMO_EMAIL = 'demo@example.com';
const isGoogleEnabled = import.meta.env.VITE_GOOGLE_ENABLED === 'true';

export function App() {
  const [verificationCode, setVerificationCode] = useState('');
  const [operation, setOperation] = useState('idle');
  const [output, setOutput] = useState<unknown>({
    message: 'Sign in to create a session.',
  });
  const isBusy = operation !== 'idle';

  async function signIn(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    setOperation('signing-in');

    try {
      const formData = new FormData(event.currentTarget);
      const email = formData.get('email');
      const password = formData.get('password');

      if (typeof email !== 'string' || typeof password !== 'string') {
        throw new Error('credentials_invalid');
      }

      const tokens = await authClient.authenticate('credentials', {
        email,
        password,
      });
      localStorage.setItem('aurelian.accessToken', tokens.accessToken);
      localStorage.setItem('aurelian.refreshToken', tokens.refreshToken);
      setOutput(tokens);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'sign_in_failed';
      setOutput({ error: { code: message, message } });
    } finally {
      setOperation('idle');
    }
  }

  async function signInWithGoogle(): Promise<void> {
    setOperation('redirecting');

    try {
      const authorization = await authClient.authorize({ provider: 'google' });
      location.assign(authorization.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'authorization_failed';
      setOutput({ error: { code: message, message } });
    } finally {
      setOperation('idle');
    }
  }

  async function requestEmailCode(): Promise<void> {
    setOperation('requesting-code');

    try {
      const response = await fetch(`${authIssuer}/code/request`, {
        body: JSON.stringify({ identifier: DEMO_EMAIL }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const result: {
        code: string;
        delivery: 'development-only-response';
        warning: string;
      } = await response.json();

      if (!response.ok) {
        setOutput(result);
        return;
      }

      setVerificationCode(result.code);
      setOutput(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'code_request_failed';
      setOutput({ error: { code: message, message } });
    } finally {
      setOperation('idle');
    }
  }

  async function signInWithEmailCode(): Promise<void> {
    setOperation('signing-in');

    try {
      const tokens = await authClient.authenticate('code', {
        code: verificationCode,
        identifier: DEMO_EMAIL,
      });
      localStorage.setItem('aurelian.accessToken', tokens.accessToken);
      localStorage.setItem('aurelian.refreshToken', tokens.refreshToken);
      setOutput(tokens);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'sign_in_failed';
      setOutput({ error: { code: message, message } });
    } finally {
      setOperation('idle');
    }
  }

  async function registerPasskey(): Promise<void> {
    setOperation('registering-passkey');

    try {
      const accessToken = localStorage.getItem('aurelian.accessToken');
      if (!accessToken) throw new Error('session_missing');
      const optionsResponse = await fetch(
        `${authIssuer}/passkey/registration/start`,
        {
          body: '{}',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          method: 'POST',
        },
      );
      const result: {
        options: PublicKeyCredentialCreationOptionsJSON;
        state: string;
      } = await optionsResponse.json();

      if (!optionsResponse.ok) {
        setOutput(result);
        return;
      }

      const passkeyResponse = await startRegistration({
        optionsJSON: result.options,
      });
      const verificationResponse = await fetch(
        `${authIssuer}/passkey/registration/verify`,
        {
          body: JSON.stringify({
            response: passkeyResponse,
            state: result.state,
          }),
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          method: 'POST',
        },
      );
      const verification: unknown = await verificationResponse.json();

      setOutput(verification);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'passkey_registration_failed';
      setOutput({ error: { code: message, message } });
    } finally {
      setOperation('idle');
    }
  }

  async function signInWithPasskey(): Promise<void> {
    setOperation('signing-in');

    try {
      const optionsResponse = await fetch(
        `${authIssuer}/passkey/authentication/start`,
      );
      const result: {
        options: PublicKeyCredentialRequestOptionsJSON;
        state: string;
      } = await optionsResponse.json();

      if (!optionsResponse.ok) {
        setOutput(result);
        return;
      }

      const response = await startAuthentication({ optionsJSON: result.options });
      const verificationResponse = await fetch(
        `${authIssuer}/passkey/authentication/verify`,
        {
          body: JSON.stringify({ response, state: result.state }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );
      const tokens: TokenResponse = await verificationResponse.json();

      if (!verificationResponse.ok) {
        setOutput(tokens);
        return;
      }

      localStorage.setItem('aurelian.accessToken', tokens.accessToken);
      localStorage.setItem('aurelian.refreshToken', tokens.refreshToken);
      setOutput(tokens);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'passkey_sign_in_failed';
      setOutput({ error: { code: message, message } });
    } finally {
      setOperation('idle');
    }
  }

  async function verifySession(): Promise<void> {
    setOperation('verifying');

    try {
      const accessToken = localStorage.getItem('aurelian.accessToken');
      if (!accessToken) throw new Error('session_missing');
      setOutput(await authClient.verify(accessToken));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'verification_failed';
      setOutput({ error: { code: message, message } });
    } finally {
      setOperation('idle');
    }
  }

  async function refreshSession(): Promise<void> {
    setOperation('refreshing');

    try {
      const refreshToken = localStorage.getItem('aurelian.refreshToken');
      if (!refreshToken) throw new Error('session_missing');
      const nextTokens = await authClient.refresh({
        refreshToken,
      });
      localStorage.setItem('aurelian.accessToken', nextTokens.accessToken);
      localStorage.setItem('aurelian.refreshToken', nextTokens.refreshToken);
      setOutput(nextTokens);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'refresh_failed';
      setOutput({ error: { code: message, message } });
    } finally {
      setOperation('idle');
    }
  }

  async function revokeSession(): Promise<void> {
    setOperation('revoking');

    try {
      const refreshToken = localStorage.getItem('aurelian.refreshToken');
      if (!refreshToken) throw new Error('session_missing');
      await authClient.revoke({ refreshToken });
      localStorage.removeItem('aurelian.accessToken');
      localStorage.removeItem('aurelian.refreshToken');
      setOutput({ revoked: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'revocation_failed';
      setOutput({ error: { code: message, message } });
    } finally {
      setOperation('idle');
    }
  }

  return (
    <main>
      <header>
        <p className="eyebrow">Aurelian / React client</p>
        <h1>Inspect a complete session lifecycle.</h1>
        <p className="summary">
          This app calls a separate Cloudflare Worker. Sign in, verify, rotate,
          and revoke without sharing server code with the browser.
        </p>
      </header>
      <div className="workspace">
        <form className="panel" onSubmit={(event) => void signIn(event)}>
          <div className="panel-heading">
            <div>
              <span>01</span>
              <h2>Authenticate</h2>
            </div>
            <span>{operation}</span>
          </div>
          <label>
            Email
            <input
              autoComplete="username"
              defaultValue={DEMO_EMAIL}
              disabled={isBusy}
              maxLength={320}
              name="email"
              required
              type="email"
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              defaultValue="password"
              disabled={isBusy}
              maxLength={1024}
              name="password"
              required
              type="password"
            />
          </label>
          <button disabled={isBusy} type="submit">
            Create session
          </button>

          <div className="provider-actions">
            {isGoogleEnabled && (
              <button
                disabled={isBusy}
                onClick={() => void signInWithGoogle()}
                type="button"
              >
                Google OAuth
              </button>
            )}
            <button
              disabled={isBusy}
              onClick={() => void requestEmailCode()}
              type="button"
            >
              Request development email code
            </button>
            <p className="hint">
              The Worker returns codes only for demo@example.com. Production
              apps must deliver codes out of band.
            </p>
            <div className="code-row">
              <input
                aria-label="Email code"
                disabled={isBusy}
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setVerificationCode(event.target.value)}
                pattern="[0-9]{6}"
                placeholder="6-digit code"
                value={verificationCode}
              />
              <button
                disabled={isBusy || !/^\d{6}$/.test(verificationCode)}
                onClick={() => void signInWithEmailCode()}
                type="button"
              >
                Use code
              </button>
            </div>
            <button
              disabled={isBusy}
              onClick={() => void registerPasskey()}
              type="button"
            >
              Register passkey
            </button>
            <button
              disabled={isBusy}
              onClick={() => void signInWithPasskey()}
              type="button"
            >
              Sign in with passkey
            </button>
          </div>

          <div className="actions">
            <button
              disabled={isBusy}
              onClick={() => void verifySession()}
              type="button"
            >
              Verify
            </button>
            <button
              disabled={isBusy}
              onClick={() => void refreshSession()}
              type="button"
            >
              Refresh
            </button>
            <button
              disabled={isBusy}
              onClick={() => void revokeSession()}
              type="button"
            >
              Revoke
            </button>
          </div>
        </form>

        <section className="panel output" aria-live="polite">
          <div className="panel-heading">
            <div>
              <span>02</span>
              <h2>Response</h2>
            </div>
            <span>JSON</span>
          </div>
          <pre>{JSON.stringify(output, null, 2)}</pre>
        </section>
      </div>
    </main>
  );
}
