import { defineConfig } from "vitest/config.js";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    alias: {
      "youtube-transcript":
        new URL(
          "./node_modules/youtube-transcript/dist/youtube-transcript.esm.js",
          import.meta.url
        ).pathname,
    },
  },
});
