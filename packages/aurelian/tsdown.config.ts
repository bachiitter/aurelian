import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    client: './src/client.ts',
    index: './src/index.ts',
    'providers/code': './src/providers/code.ts',
    'providers/credentials': './src/providers/credentials.ts',
    'providers/discord': './src/providers/discord.ts',
    'providers/github': './src/providers/github.ts',
    'providers/google': './src/providers/google.ts',
    'providers/oauth': './src/providers/oauth.ts',
    'providers/oidc': './src/providers/oidc.ts',
    'providers/passkey': './src/providers/passkey.ts',
    'providers/twitch': './src/providers/twitch.ts',
    profiles: './src/profiles.ts',
    server: './src/server.ts',
    'storage/cloudflare-kv': './src/storage/cloudflare-kv.ts',
    'storage/index': './src/storage/index.ts',
    'storage/memory': './src/storage/memory.ts',
  },
  dts: true,
  exports: true,
  treeshake: true,
  format: 'esm',
});
