import { test, expect } from "@playwright/test";

test("Both built pages load local assets and the editor works", async ({ page }) => {
  const errors = [];
  const external = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4173") {
      external.push(request.url());
    }
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Простой редактор Markdown", exact: true })).toBeVisible();
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  await page.locator('[data-workspace-target="fileInput"]').setInputFiles("tests/fixtures/banner-notes.md");
  await expect(page.locator(".cm-content")).toContainText("Mobile");
  await page.locator(".cm-content").fill("# Built editor\n```js\nconst value = 1\n```");
  await page.getByRole("button", { name: "Жирный", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("**");
  await expect(page.locator('[data-editor-target="download"]')).toBeVisible();
  const download = page.waitForEvent("download");
  await page.locator('[data-editor-target="download"]').click();
  const awaitedResult1 = await download;
  expect(awaitedResult1.suggestedFilename()).toBe("banner-notes.md");
  await page.locator('[data-workspace-target="fileInput"]').setInputFiles("src/public/assets/app-icon.svg");
  await expect(page.locator("object")).toHaveAttribute("type", "image/svg+xml");
  const awaitedResult2 = await page.request.get("/manifest.webmanifest");
  const manifest = await awaitedResult2.json();
  expect(manifest.start_url).toBe("./edit.html?app=1");
  for (const icon of manifest.icons) {
    // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
    const awaitedResult3 = await page.request.get(`/${icon.src}`);
    expect(awaitedResult3.ok()).toBe(true);
  }
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("Installed homepage shortcuts enter the editor directly", async ({ page }) => {
  await page.addInitScript(() => {
    const original = matchMedia.bind(globalThis);
    globalThis.matchMedia = (query) =>
      query === "(display-mode: standalone)" ? { matches: true } : original(query);
  });
  await page.goto("/");
  await expect(page).toHaveURL(/edit\.html\?app=1$/);
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("[data-native-install]")).toBeHidden();
});

test("Code files disable formatting and use syntax highlighting in both themes", async ({ page }) => {
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  for (const colorScheme of ["light", "dark"]) {
    // eslint-disable-next-line no-await-in-loop -- Verify each theme and file in order.
    await page.emulateMedia({ colorScheme });
    for (const [name, text, token] of [
      ["app.PHP", '<?php echo "hello";', "echo"],
      ["style.css", "body { color: red; }", "color"],
      ["app.js", "const answer = 42;", "const"],
      ["index.html", '<h1 class="title">Hello</h1>', "h1"],
      ["query.sql", "SELECT name FROM users;", "SELECT"],
    ]) {
      // eslint-disable-next-line no-await-in-loop -- Verify each theme and file in order.
      await page
        .locator('[data-workspace-target="fileInput"]')
        .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
      // eslint-disable-next-line no-await-in-loop -- Verify each theme and file in order.
      await expect(page.locator(".cm-content")).toHaveText(text);
      // eslint-disable-next-line no-await-in-loop -- Verify each theme and file in order.
      await expect(page.locator(".toolbar-group .tool-btn:disabled")).toHaveCount(10);
      // eslint-disable-next-line no-await-in-loop -- Verify each theme and file in order.
      await expect(page.locator(".cm-content span[class]").filter({ hasText: token }).first()).toBeVisible();
      // eslint-disable-next-line no-await-in-loop -- Verify each theme and file in order.
      await expect(page.locator('[data-editor-target="download"]')).toBeEnabled();
    }
  }
  await page
    .locator('[data-workspace-target="fileInput"]')
    .setInputFiles({ name: "plain.txt", mimeType: "text/plain", buffer: Buffer.from("# Plain text") });
  await expect(page.locator(".cm-md-heading-1")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Жирный", exact: true })).toBeDisabled();
  await page.locator('[data-workspace-target="fileInput"]').setInputFiles("tests/fixtures/banner-notes.md");
  await expect(page.getByRole("button", { name: "Жирный", exact: true })).toBeEnabled();
});
