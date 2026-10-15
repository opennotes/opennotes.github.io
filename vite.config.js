import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(repoRoot, "src");

export default defineConfig({
  root: sourceRoot,
  publicDir: path.resolve(sourceRoot, "public"),
  cacheDir: path.resolve(repoRoot, "node_modules/.vite"),
  base: "./",
  build: {
    outDir: path.resolve(repoRoot, "dist"),
    emptyOutDir: true,
    target: "es2022",
    rolldownOptions: {
      input: {
        home: path.resolve(sourceRoot, "index.html"),
        editor: path.resolve(sourceRoot, "edit.html"),
        install: path.resolve(sourceRoot, "install.html"),
      },
    },
  },
  test: {
    root: repoRoot,
    environment: "jsdom",
    include: [
      "tests/unit/**/*.test.js",
    ],
    setupFiles: [
      "tests/support/setup.js",
    ],
    environmentOptions: { jsdom: { url: "https://opennotes.test/edit.html" } },
    coverage: {
      provider: "v8",
      include: [
        "src/js/**/*.js",
      ],
      reporter: [
        "text",
        "html",
        "lcov",
        "json",
        "json-summary",
      ],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
