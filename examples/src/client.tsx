import { createClient } from 'aurelian/client';
import { render } from 'hono/jsx/dom';
import { useState } from 'hono/jsx';

const authClient = createClient<{
  properties: { id: string };
  type: 'user';
}>({
  issuer: 'http://localhost:3000/auth',
});

function App() {
  const [output, setOutput] = useState<unknown>({ ready: true });

  async function signIn(event: Event) {
    event.preventDefault();

    const form = new FormData(event.currentTarget as HTMLFormElement);
    const tokens = await authClient.authenticate('password', {
      email: form.get('email'),
      password: form.get('password'),
    });

    localStorage.setItem('aurelian.accessToken', tokens.accessToken);
    localStorage.setItem('aurelian.refreshToken', tokens.refreshToken);
    setOutput(tokens);
  }

  async function verifySession() {
    const accessToken = localStorage.getItem('aurelian.accessToken');

    if (!accessToken) {
      setOutput({ error: 'missing_access_token' });
      return;
    }

    setOutput(await authClient.verify(accessToken));
  }

  return (
    <main>
      <h1>Aurelian</h1>
      <form onSubmit={signIn}>
        <input name="email" type="email" value="demo@example.com" />
        <input name="password" type="password" value="password" />
        <button type="submit">Sign in</button>
      </form>
      <button onClick={verifySession} type="button">
        Verify session
      </button>
      <pre>{JSON.stringify(output, null, 2)}</pre>
    </main>
  );
}

const root = document.getElementById('root');

if (root) {
  render(<App />, root);
}
