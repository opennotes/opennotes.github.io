import { test, expect } from "@playwright/test";

import { uploadTextProject } from "../support/upload-project.js";

test("Both built pages load local assets and the editor works", async ({ page, baseURL }) => {
  const errors = [];
  const external = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL).origin) {
      external.push(request.url());
    }
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Ваши заметки. В ваших файлах.", exact: true }),
  ).toBeVisible();
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

test("JSON, TypeScript and XML have colored syntax and updating line numbers", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("opennotes.lineNumbers", "true"));
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  for (const colorScheme of ["light", "dark"]) {
    // eslint-disable-next-line no-await-in-loop -- Verify each theme and document in order.
    await page.emulateMedia({ colorScheme });
    for (const [name, text, token] of [
      ["config.JSON", '{\n  "enabled": true\n}', '"enabled"'],
      ["module.TS", "interface Note {\n  title: string;\n}", "interface"],
      ["data.XML", '<note id="1">\n  <title>Hello</title>\n</note>', "note"],
    ]) {
      // eslint-disable-next-line no-await-in-loop -- Verify each theme and document in order.
      await page
        .locator('[data-workspace-target="fileInput"]')
        .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
      // eslint-disable-next-line no-await-in-loop -- Verify each theme and document in order.
      await expect(page.locator(".cm-line")).toHaveText(text.split("\n"));
      const syntaxToken = page.locator(".cm-content span[class]").filter({ hasText: token }).first();
      // eslint-disable-next-line no-await-in-loop -- Verify each theme and document in order.
      await expect(syntaxToken).toBeVisible();
      // eslint-disable-next-line no-await-in-loop -- Verify each theme and document in order.
      const colorsDiffer = await syntaxToken.evaluate(
        (element) =>
          getComputedStyle(element).color !== getComputedStyle(element.closest(".cm-content")).color,
      );
      expect(colorsDiffer).toBe(true);
      // eslint-disable-next-line no-await-in-loop -- Verify each theme and document in order.
      await expect(
        page.locator(".cm-lineNumbers .cm-gutterElement").filter({ hasText: /^3$/ }),
      ).toBeVisible();
      // eslint-disable-next-line no-await-in-loop -- Verify each theme and document in order.
      await page.locator(".cm-content").fill(`${text}\n`);
      // eslint-disable-next-line no-await-in-loop -- Verify each theme and document in order.
      await expect(
        page.locator(".cm-lineNumbers .cm-gutterElement").filter({ hasText: /^4$/ }),
      ).toBeVisible();
      // eslint-disable-next-line no-await-in-loop -- Verify each theme and document in order.
      await expect(page.getByRole("button", { name: "Жирный", exact: true })).toBeDisabled();
    }
  }
  await page.locator('[data-workspace-target="fileInput"]').setInputFiles("tests/fixtures/banner-notes.md");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await expect(page.getByRole("button", { name: "Жирный", exact: true })).toBeEnabled();
});

test("Line-number toolbar toggle persists across reloads and remains available for code", async ({
  page,
}) => {
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  await expect(page.locator(".tree-empty")).toHaveCSS("text-wrap", "balance");
  const input = page.locator('[data-workspace-target="fileInput"]');
  await input.setInputFiles({
    name: "app.ts",
    mimeType: "text/plain",
    buffer: Buffer.from("const x = 1;\nconst y = 2;"),
  });
  const toggle = page.getByRole("button", { name: "Номера строк", exact: true });
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.locator(".cm-content").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("keep this draft");
  await toggle.click();
  await expect(page.locator(".cm-content")).toHaveText("keep this draft");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await toggle.click();
  await input.setInputFiles("tests/fixtures/banner-notes.md");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.reload();
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  await input.setInputFiles("tests/fixtures/banner-notes.md");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await toggle.click();
  await page.reload();
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  await input.setInputFiles("tests/fixtures/banner-notes.md");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await input.setInputFiles("src/public/assets/app-icon.svg");
  await expect(toggle).toBeHidden();
});

test("Cursor coordinates follow keyboard edits and disappear in previews", async ({ page }) => {
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  const position = page.locator('[data-editor-target="cursorPosition"]');
  const input = page.locator('[data-workspace-target="fileInput"]');
  await expect(position).toBeHidden();
  await input.setInputFiles({
    name: "note.ts",
    mimeType: "text/plain",
    buffer: Buffer.from("one\r\ntwo"),
  });
  await expect(position).toHaveText("Стр 1 · Стлб 1");
  await page.locator(".cm-content").focus();
  await page.keyboard.press("ControlOrMeta+End");
  await expect(position).toHaveText("Стр 2 · Стлб 4");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(position).toHaveText("Стр 2 · Стлб 3");
  await page.keyboard.type("!");
  await expect(position).toHaveText("Стр 2 · Стлб 4");
  await input.setInputFiles("src/public/assets/app-icon.svg");
  await expect(position).toBeHidden();
  await input.setInputFiles("tests/fixtures/banner-notes.md");
  await expect(position).toHaveText("Стр 1 · Стлб 1");
});

for (const width of [1280, 390]) {
  test(`Reveal in tree expands the current file and preserves its draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/edit.html");
    await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
    const warning = page.getByRole("button", { name: "Закрыть предупреждение" });
    if (await warning.isVisible()) {
      await warning.click();
    }
    await page.locator('[data-workspace-target="directoryInput"]').setInputFiles("tests/fixtures/copy-path");
    if (width === 390) {
      await page.locator('.mobile-bar [data-action="workspace#toggleSidebar"]').click();
    }
    const folder = page.locator('.tree-item[data-path="Мои заметки"]');
    const file = page.locator('.tree-item[data-path="Мои заметки/A B.md"]');
    await folder.locator(".label").click();
    await file.locator(".label").click();
    await page.locator(".cm-content").fill("Keep this draft");
    if (width === 390) {
      await page.locator('.mobile-bar [data-action="workspace#toggleSidebar"]').click();
    }
    await folder.locator(".label").click();
    await expect(file).toBeHidden();
    if (width === 390) {
      await page.locator(".close-sidebar").click();
    }
    const reveal = page.getByRole("button", { name: "Показать в дереве", exact: true });
    await expect(reveal).toHaveText("Мои заметки/A B.md");
    await reveal.focus();
    await page.keyboard.press("Enter");
    await expect(file).toBeVisible();
    await expect(file).toBeFocused();
    await expect(file).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".cm-content")).toHaveText("Keep this draft");
    await expect(folder).toHaveAttribute("aria-expanded", "true");
    if (width === 390) {
      await expect(page.locator(".sidebar")).toHaveClass(/open/);
    }
    if (width !== 390) {
      await expect(page.locator(".overlay")).toBeHidden();
    }
  });
}

test("Tree icons distinguish file purposes and dot entries in both themes", async ({ page }) => {
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  await uploadTextProject(page, "tests/fixtures/icon-types");
  const row = (path) => page.locator(`.tree-item[data-path="${path}"]`);
  await row(".github").locator(".label").click();
  await row("src").locator(".label").click();
  for (const [path, type] of [
    [".gitignore", "git"],
    [".env.example", "config"],
    [".editorconfig", "config"],
    [".custom", "dotFile"],
    [".github", "dotFolder"],
    [".github/ci.yml", "data"],
    ["src", "folder"],
    ["src/app.TS", "code"],
    ["note.md", "md"],
    ["index.html", "markup"],
    ["style.css", "style"],
    ["data.json", "data"],
    ["query.sql", "database"],
    ["run.sh", "terminal"],
    ["photo.svg", "image"],
    ["unknown.custom", "file"],
  ]) {
    const item = row(path);
    // eslint-disable-next-line no-await-in-loop -- Verify each rendered file's semantics in sequence.
    await expect(item.locator(".ico")).toHaveAttribute("data-file-icon", type);
    // eslint-disable-next-line no-await-in-loop -- Verify each rendered file's semantics in sequence.
    await expect(item.locator(".ico")).toHaveAttribute("aria-hidden", "true");
    // eslint-disable-next-line no-await-in-loop -- Verify each rendered file's semantics in sequence.
    await expect(item).toHaveAttribute("aria-label", path.split("/").at(-1));
  }
  for (const colorScheme of ["light", "dark"]) {
    // eslint-disable-next-line no-await-in-loop -- Verify each theme before selecting a file.
    await page.emulateMedia({ colorScheme });
    const neutral = row("data.json").locator(".ico");
    const accent = colorScheme === "light" ? "rgb(0, 122, 255)" : "rgb(10, 132, 255)";
    // eslint-disable-next-line no-await-in-loop -- Verify the folder accent in each theme.
    await expect(row(".github").locator(".ico")).toHaveCSS("color", accent);
    // eslint-disable-next-line no-await-in-loop -- Verify each theme before selecting a file.
    const color = await neutral.evaluate((element) => getComputedStyle(element).color);
    // eslint-disable-next-line no-await-in-loop -- Verify each theme before selecting a file.
    await expect(row(".gitignore").locator(".ico")).toHaveCSS("color", color);
    // eslint-disable-next-line no-await-in-loop -- Verify each theme before selecting a file.
    await expect(row(".custom").locator(".ico")).toHaveCSS("opacity", "1");
    // eslint-disable-next-line no-await-in-loop -- Verify each theme before selecting a file.
    await row("note.md").locator(".label").click();
    // eslint-disable-next-line no-await-in-loop -- Verify selected icon contrast in each theme.
    await expect(row("note.md").locator(".ico")).toHaveCSS("color", "rgb(255, 255, 255)");
    // eslint-disable-next-line no-await-in-loop -- Verify selected label contrast in each theme.
    await expect(row("note.md").locator(".label")).toHaveCSS("color", "rgb(255, 255, 255)");
  }
  await row("note.md").focus();
  await page.keyboard.press("F2");
  await page.locator('[data-tree-target="actionInput"]').fill("note.ts");
  await page.locator('[data-tree-target="actionSubmit"]').click();
  await expect(row("note.ts").locator(".ico")).toHaveAttribute("data-file-icon", "code");
  await expect(row("note.ts")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".cm-content")).toContainText("Notes");
});

test("Unified creation previews nested paths, opens files and supports folders in context", async ({
  page,
}) => {
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  const create = page.locator('[data-action="tree#createRoot"]');
  const dialog = page.getByRole("dialog", { name: "Создать", exact: true });
  const input = dialog.getByRole("textbox", { name: "Путь", exact: true });
  const type = dialog.getByRole("combobox", { name: "Тип объекта" });
  const hint = dialog.locator('[data-tree-target="creationHint"]');
  await create.click();
  await input.fill("заметки/идеи/первая.md");
  await expect(type).toHaveValue("file");
  await expect(hint).toHaveText("Файл · Новый проект/заметки/идеи/первая.md");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".cm-content")).toBeFocused();
  await page.keyboard.insertText("# Keep this draft");
  await expect(page.locator('.tree-item[data-path="заметки/идеи/первая.md"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "Действия: идеи", exact: true }).click();
  await page.getByRole("button", { name: "Создать…", exact: true }).click();
  await input.fill("архив/2026");
  await expect(type).toHaveValue("directory");
  await expect(hint).toHaveText("Папка · Новый проект/заметки/идеи/архив/2026");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page.locator('.tree-item[data-path="заметки/идеи/архив/2026"]')).toBeFocused();
  await expect(page.locator(".cm-content")).toHaveText("# Keep this draft");
  await create.click();
  await input.fill("README");
  await expect(type).toHaveValue("file");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page.locator('[data-editor-target="pathLabel"]')).toHaveText("README");
  await expect(page.locator(".cm-content")).toBeFocused();
  await create.click();
  await input.fill("release.v1");
  await type.selectOption("directory");
  await expect(hint).toHaveText("Папка · Новый проект/release.v1");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page.locator('.tree-item[data-path="release.v1"]')).toHaveAttribute("aria-expanded", "true");
});

test("Creation validates paths and collisions, and keeps explicit type choices", async ({ page }) => {
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  const create = page.locator('[data-action="tree#createRoot"]');
  const dialog = page.getByRole("dialog", { name: "Создать", exact: true });
  const input = dialog.getByRole("textbox", { name: "Путь", exact: true });
  await create.click();
  await input.fill("notes");
  await dialog.getByRole("combobox", { name: "Тип объекта" }).selectOption("file");
  await input.fill("scratch");
  await expect(dialog.locator('[data-tree-target="creationHint"]')).toHaveText("Файл · Новый проект/scratch");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeFocused();
  await page.keyboard.insertText("keep");
  await create.click();
  await input.fill("scratch");
  await dialog.getByRole("combobox", { name: "Тип объекта" }).selectOption("file");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("уже существует");
  await expect(page.locator(".cm-content")).toHaveText("keep");
  await input.fill("../outside.md");
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Введите относительный путь");
  await input.fill("notes.md");
  await expect(dialog.getByRole("alert")).toBeEmpty();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(page.locator('.tree-item[data-path="notes.md"]')).toHaveCount(0);
});

test("Mobile creation keeps long path previews inside the dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  const warning = page.getByRole("button", { name: "Закрыть предупреждение" });
  if (await warning.isVisible()) {
    await warning.click();
  }
  await page.locator('.mobile-bar [data-action="workspace#toggleSidebar"]').click();
  await page.locator('[data-action="tree#createRoot"]').click();
  const dialog = page.getByRole("dialog", { name: "Создать", exact: true });
  const path = "Очень длинное название проекта/Вложенная папка с заметками/Файл с длинным названием.md";
  await dialog.getByRole("textbox", { name: "Путь", exact: true }).fill(path);
  const hint = dialog.locator('[data-tree-target="creationHint"]');
  await expect(hint).toHaveText(`Файл · Новый проект/${path}`);
  const fits = await dialog.evaluate((element) => element.getBoundingClientRect().right <= innerWidth);
  expect(fits).toBe(true);
  const scrolls = await hint.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(scrolls).toBe(true);
  await dialog.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
});
