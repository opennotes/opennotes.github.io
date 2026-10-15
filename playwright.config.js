import { defineConfig, devices } from "@playwright/test";

const isPreview = process.env.OPEN_NOTES_PREVIEW === "1";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4173", ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  webServer: {
    command: isPreview
      ? "npm run preview -- --port 4173 --strictPort"
      : "npm run dev -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
  projects: isPreview
    ? [
        {
          name: "dist",
          testMatch: [
            "dist.spec.js",
            "install.spec.js",
          ],
        },
        {
          name: "dist-firefox",
          testMatch: [
            "dist.spec.js",
            "install.spec.js",
          ],
          use: { ...devices["Desktop Firefox"] },
        },
        {
          name: "dist-webkit",
          testMatch: [
            "dist.spec.js",
            "install.spec.js",
          ],
          use: { ...devices["Desktop Safari"] },
        },
      ]
    : [
        { name: "chromium", testMatch: "regressions.spec.js" },
        { name: "performance", testMatch: "performance.spec.js" },
      ],
});
