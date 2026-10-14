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

test("Sidebar boundary supports dragging, limits, keyboard and reset", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  const separator = page.getByRole("separator", { name: "Ширина бокового меню" });
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toHaveCSS("width", "260px");
  const boundary = await separator.boundingBox();
  await page.mouse.move(boundary.x + boundary.width / 2, boundary.y + 100);
  await expect(separator).toHaveCSS("cursor", "col-resize");
  await page.mouse.down();
  await page.mouse.move(boundary.x + boundary.width / 2 + 140, boundary.y + 100);
  await expect(sidebar).toHaveCSS("width", "400px");
  await expect(separator).toHaveAttribute("aria-valuenow", "400");
  await page.mouse.move(1200, boundary.y + 100);
  await expect(sidebar).toHaveCSS("width", "560px");
  await page.mouse.move(0, boundary.y + 100);
  await expect(sidebar).toHaveCSS("width", "220px");
  await page.mouse.up();
  await expect(page.locator(".app")).not.toHaveClass(/sidebar-resizing/);
  await page.mouse.move(700, 200);
  await expect(sidebar).toHaveCSS("width", "220px");
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(sidebar).toHaveCSS("width", "236px");
  await page.keyboard.press("End");
  await expect(sidebar).toHaveCSS("width", "560px");
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(sidebar).toHaveCSS("width", "440px");
  await expect(separator).toHaveAttribute("aria-valuenow", "440");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(sidebar).toHaveCSS("width", "560px");
  await separator.dblclick();
  await expect(sidebar).toHaveCSS("width", "260px");
});

test("Desktop sidebar resizing leaves the mobile drawer unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  const warning = page.getByRole("button", { name: "Закрыть предупреждение" });
  if (await warning.isVisible()) {
    await warning.click();
  }

  const separator = page.getByRole("separator", { name: "Ширина бокового меню" });
  await separator.focus();
  await page.keyboard.press("End");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(separator).toBeHidden();
  await expect(page.locator(".sidebar")).toHaveCSS("width", "300px");
  await expect(page.locator(".main")).toHaveCSS("width", "390px");
  await page.locator('.mobile-bar [data-action="workspace#toggleSidebar"]').click();
  await expect(page.locator(".sidebar")).toHaveClass(/open/);
  await page.locator(".close-sidebar").click();
  await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(separator).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCSS("width", "560px");
});

test("Context menu copies file and folder paths without changing the draft", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.copiedPaths = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(text) {
          globalThis.copiedPaths.push(text);
        },
      },
    });
  });
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  await page.locator('[data-workspace-target="directoryInput"]').setInputFiles("tests/fixtures/copy-path");
  await page.locator('.tree-item[data-path="Мои заметки"] .label').click();
  await page.locator('.tree-item[data-path="Мои заметки/A B.md"] .label').click();
  await expect(page.locator(".cm-content")).toContainText("Nested note");
  await page.locator(".cm-content").fill("Keep this draft");
  await page.getByRole("button", { name: "Действия: Мои заметки", exact: true }).click();
  await page.getByRole("button", { name: "Копировать путь", exact: true }).click();
  await expect(page.locator('[data-tree-target="contextMenu"]')).toBeHidden();
  await expect(page.locator('[data-workspace-target="toast"]')).toHaveText("Путь скопирован");
  expect(await page.evaluate(() => globalThis.copiedPaths)).toEqual(["Мои заметки"]);
  const file = page.locator('.tree-item[data-path="Мои заметки/A B.md"]');
  await file.click({ button: "right" });
  await page.getByRole("button", { name: "Копировать путь", exact: true }).click();
  expect(await page.evaluate(() => globalThis.copiedPaths)).toEqual(["Мои заметки", "Мои заметки/A B.md"]);
  await expect(file).toBeFocused();
  await expect(page.locator(".cm-content")).toHaveText("Keep this draft");
  await expect(page.locator('[data-tree-target="actionDialog"]')).not.toBeVisible();
});
