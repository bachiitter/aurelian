import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    client: "./src/client.ts",
    server: "./src/server.ts",
    "providers/*": "./src/providers/*.ts",
    "storage/*": "./src/storage/*.ts",
  },
  dts: true,
  exports: true,
  treeshake: true,
  // minify: true,
  format: "esm",
});
