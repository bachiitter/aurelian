const exports = [
  '.',
  './client',
  './profiles',
  './providers/code',
  './providers/credentials',
  './providers/discord',
  './providers/github',
  './providers/google',
  './providers/oauth',
  './providers/oidc',
  './providers/passkey',
  './providers/password',
  './providers/twitch',
  './server',
  './storage',
  './storage/cloudflare-kv',
  './storage/memory',
  './storage/sqlite',
];

function getDistPath(specifier) {
  if (specifier === '.') {
    return '../dist/index.mjs';
  }

  if (specifier === './storage') {
    return '../dist/storage/index.mjs';
  }

  return `../dist/${specifier.slice(2)}.mjs`;
}

await Promise.all(exports.map((specifier) => import(getDistPath(specifier))));
