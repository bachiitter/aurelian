import { writeFile } from 'node:fs/promises';
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

const keyPair = await generateKeyPair('ES256', { extractable: true });
const [privateKey, publicKey] = await Promise.all([
  exportPKCS8(keyPair.privateKey),
  exportSPKI(keyPair.publicKey),
]);
const variables = [
  'APP_ORIGIN="http://localhost:5173"',
  'AUTH_ISSUER="http://localhost:8787/auth"',
  `AUTH_PRIVATE_KEY=${JSON.stringify(privateKey)}`,
  `AUTH_PUBLIC_KEY=${JSON.stringify(publicKey)}`,
  'DEMO_PASSWORD="password"',
  '',
].join('\n');

await writeFile(new URL('../.dev.vars', import.meta.url), variables, {
  encoding: 'utf8',
  mode: 0o600,
});
