import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    client: './src/client.ts',
    index: './src/index.ts',
    'providers/google': './src/providers/google.ts',
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
