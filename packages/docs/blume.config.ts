import { defineConfig } from "blume";

export default defineConfig({
  content: {
    root: "content/docs",
  },
  deployment: {
    output: "static",
  },
  title: "Aurelian",
  description: "Small authentication primitives for apps that own users.",
  feedback: false,
  github: {
    dir: "packages/docs",
    owner: "bachiitter",
    repo: "aurelian",
  },
  theme: {
    radius: "md",
  },
});
