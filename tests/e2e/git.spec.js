import { test, expect } from "@playwright/test";

import {
  fixtureFiles,
  gitFixture,
  nativeGit,
  openGitFolder,
  removeFixture,
  storeGitFolder,
} from "../support/git-fixture.js";

let fixture;
let files;

test.beforeAll(async () => {
  fixture = await gitFixture();
  files = await fixtureFiles(fixture.root);
});

test.afterAll(async () => {
  await removeFixture(fixture.root);
});

test("Browser Git reads packed history, staged/working changes, deletions and live disk updates", async ({
  page,
  browserName,
}) => {
  // Only Chromium grants user-selected local folders; other engines verify the explanatory state.
  test.skip(browserName !== "chromium", "Local folder grants require File System Access in Chrome or Edge.");
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  await openGitFolder(page, files);
  await expect(page.locator('[data-git-target="launch"]')).toHaveText("Git · main");
  await page.locator('[data-git-target="launch"]').click();
  const dialog = page.locator("#editor-diff-pane");
  const patch = dialog.locator(".git-patch");
  await dialog.locator('[data-area="working"][data-path="note.md"]').click();
  await expect(patch).toContainText("staged");
  await expect(patch).toContainText("working");
  await dialog.locator('[data-area="staged"][data-path="note.md"]').click();
  await expect(patch).toContainText("before");
  await expect(patch).toContainText("staged");
  await dialog.locator('[data-area="working"][data-path="deleted.md"]').click();
  await expect(patch).toContainText("gone");
  await dialog.locator('[data-area="untracked"][data-path="new note.md"]').click();
  await expect(patch).toContainText("new note");
  await expect(dialog.locator('[data-path="ignored.txt"]')).toHaveCount(0);
  await dialog.getByRole("tab", { name: "История", exact: true }).click();
  await dialog.getByRole("button", { name: /Initial notes/ }).click();
  await dialog.locator('[data-git-target="commitFileList"] [data-path="note.md"]').click();
  await expect(patch).toContainText("before");
  await page.evaluate(async () => {
    const file = await globalThis.gitTestFolder.getFileHandle("note.md");
    const writer = await file.createWritable();
    await writer.write("updated on disk\n");
    await writer.close();
  });
  await dialog.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(dialog.locator('[data-git-target="status"]')).toBeEmpty();
  await dialog.getByRole("tab", { name: "Изменения", exact: true }).click();
  await dialog.locator('[data-area="working"][data-path="note.md"]').click();
  await expect(patch).toContainText("updated on disk");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("Browser Git explains folder access and fits a narrow screen", async ({ page }) => {
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  await page.locator('[data-git-target="launch"]').click();
  const dialog = page.locator("#editor-diff-pane");
  await expect(dialog.locator('[data-git-target="status"]')).toContainText("Откройте папку");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((element) => element.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Закрыть вкладку изменений", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test("Linked worktrees request only the extra folder permission and read shared history", async ({
  page,
  browserName,
}) => {
  // Local folder picker permissions are available only in Chromium.
  // Only Chromium grants user-selected local folders; other engines verify the explanatory state.
  test.skip(browserName !== "chromium", "Local folder grants require File System Access in Chrome or Edge.");
  const linkedPath = `${fixture.root}-linked`;
  nativeGit(fixture.root, ["worktree", "add", "-b", "feature", linkedPath]);
  try {
    const linkedFiles = await fixtureFiles(linkedPath);
    const mainFiles = await fixtureFiles(fixture.root);
    await page.goto("/edit.html");
    await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
    await openGitFolder(page, linkedFiles);
    await page.locator('[data-git-target="launch"]').click();
    const dialog = page.locator("#editor-diff-pane");
    await expect(dialog.locator('[data-git-target="status"]')).toContainText("worktree");
    await storeGitFolder(page, mainFiles);
    await dialog.getByRole("button", { name: "Выбрать основной репозиторий" }).click();
    await expect(page.locator('[data-git-target="launch"]')).toHaveText("Git · feature");
    await expect(dialog.locator('[data-git-target="changes"]')).toContainText("чистая");
    await dialog.getByRole("tab", { name: "История", exact: true }).click();
    await dialog.getByRole("button", { name: /Initial notes/ }).click();
    await dialog.locator('[data-git-target="commitFileList"] [data-path="note.md"]').click();
    await expect(dialog.locator(".git-patch")).toContainText("before");
  } finally {
    await removeFixture(linkedPath);
  }
});

test("File toolbar opens its history and a read-only side-by-side diff", async ({ page, browserName }) => {
  // File System Access folder grants are available only in Chromium.
  test.skip(browserName !== "chromium", "Local folder grants require Chrome or Edge.");
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  await openGitFolder(page, files);
  await page.locator('.tree-item[data-path="note.md"] .label').click();
  await page.getByRole("button", { name: "История файла", exact: true }).click();
  const dialog = page.locator("#editor-diff-pane");
  await expect(dialog.locator('[data-git-target="fileHistoryTitle"]')).toHaveText("История · note.md");
  await expect(dialog.locator(".cm-merge-a .cm-content")).toContainText("before");
  await expect(dialog.locator(".cm-merge-b .cm-content")).toContainText("working");
  await expect(dialog.locator(".cm-changedText")).not.toHaveCount(0);
  await page.keyboard.press("F7");
  await expect(dialog.locator(".cm-lineNumbers")).toHaveCount(2);
  await expect(dialog.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(dialog.locator('[data-git-target="changeSection"]')).toBeHidden();
  await dialog.getByRole("tab", { name: "История", exact: true }).click();
  await dialog.getByRole("button", { name: /Initial notes/ }).click();
  await expect(dialog.locator(".cm-merge-b .cm-content")).toContainText("before");
  await dialog.getByRole("button", { name: "Рабочая версия", exact: true }).click();
  await expect(dialog.locator(".cm-merge-b .cm-content")).toContainText("working");
  await dialog.getByRole("combobox", { name: "Вид diff" }).selectOption("unified");
  await expect(dialog.locator(".cm-editor")).toHaveCount(1);
  await expect(dialog.locator(".cm-deletedChunk")).toContainText("before");
  await dialog.getByRole("combobox", { name: "Вид diff" }).selectOption("split");
  await expect(dialog.locator(".cm-editor")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Следующее изменение", exact: true }).click();
  await page.keyboard.press("Shift+F7");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-editor-target="editor"] .cm-content')).toContainText("working");
});

test("Git navigation keeps the selected revision explicit and adapts narrow screens", async ({
  page,
  browserName,
}) => {
  // Local folder grants require File System Access in Chromium.
  test.skip(browserName !== "chromium", "Local folder grants require Chrome or Edge.");
  await page.goto("/edit.html");
  await openGitFolder(page, files);
  await page.locator('[data-git-target="launch"]').click();
  const dialog = page.locator("#editor-diff-pane");
  await expect(dialog.locator(".cm-editor")).toHaveCount(2);
  const changes = dialog.locator('[data-git-target="changes"]');
  await expect(changes.locator('[aria-current="true"]')).toHaveCount(1);
  const note = changes.locator('[data-area="working"][data-path="note.md"]');
  await note.click();
  await expect(dialog.locator('[data-git-target="afterLabel"]')).toHaveText("Рабочая копия");
  await dialog.getByRole("button", { name: "Следующее изменение", exact: true }).click();
  await expect(note).toHaveAttribute("aria-current", "true");
  await note.focus();
  await page.keyboard.press("ArrowDown");
  await expect(changes.locator('[data-path="new note.md"]')).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("ArrowUp");
  await expect(note).toHaveAttribute("aria-current", "true");
  await dialog.getByRole("tab", { name: "Изменения", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "История", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.locator('[data-git-target="commitFiles"]')).toBeVisible();
  await dialog.locator('[data-git-target="commitFileList"] [data-path="note.md"]').click();
  await expect(dialog.locator('[data-git-target="afterLabel"]')).toContainText("Коммит");
  await dialog.getByRole("tab", { name: "История", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.locator('[data-git-target="afterLabel"]')).toHaveText("Рабочая копия");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole("combobox", { name: "Вид diff" })).toHaveValue("unified");
  await expect(dialog.locator(".cm-editor")).toHaveCount(1);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("Editor tabs retain drafts and undo while the project tree stays usable", async ({
  page,
  browserName,
}) => {
  // Local folder grants require File System Access in Chromium.
  test.skip(browserName !== "chromium", "Local folder grants require Chrome or Edge.");
  await page.goto("/edit.html");
  await openGitFolder(page, files);
  const treeFile = page.locator('.tree-item[data-path="note.md"] .label');
  await treeFile.click();
  const editor = page.locator('[data-editor-target="editor"] .cm-content');
  await editor.fill("draft before switching\n");
  await page.getByRole("button", { name: "Изменения файла", exact: true }).click();
  const diff = page.locator("#editor-diff-pane");
  await expect(diff.locator(".git-patch")).toContainText("draft before switching");
  await expect(diff.locator(".git-navigation")).toBeHidden();
  await diff.getByRole("button", { name: "История файла", exact: true }).click();
  await expect(diff.locator(".git-navigation")).toBeVisible();
  await expect(diff.getByRole("button", { name: /Initial notes/ })).toBeVisible();
  await diff.getByRole("tab", { name: "Изменения", exact: true }).click();
  await expect(diff.locator(".git-navigation")).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const fileTab = page.getByRole("tab", { name: "note.md", exact: true });
  const diffTab = page.getByRole("tab", { name: "note.md · изменения", exact: true });
  await fileTab.click();
  await expect(editor).toContainText("draft before switching");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("second edit");
  await diffTab.click();
  await expect(diff.locator(".git-patch")).toContainText("second edit");
  await fileTab.click();
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("second edit");
  await diffTab.click();
  await expect(diff).toBeVisible();
  await treeFile.click();
  await expect(editor).toBeVisible();
  await diffTab.click();
  await page.locator('.tree-item[data-path="new note.md"] .label').click();
  await expect(editor).toContainText("new note");
  await expect(page.getByRole("tab", { name: "new note.md", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await diffTab.click();
  await expect(diff.locator('[data-git-target="heading"]')).toHaveText("note.md");
  await diff.getByRole("button", { name: "Закрыть вкладку изменений", exact: true }).click();
  await expect(editor).toContainText("new note");
  await expect(page.getByRole("tablist", { name: "Рабочая область", exact: true })).toBeHidden();
});

test("File and diff tabs preserve independent scroll positions for long documents", async ({
  page,
  browserName,
}) => {
  // Local folder grants require File System Access in Chromium.
  test.skip(browserName !== "chromium", "Local folder grants require Chrome or Edge.");
  await page.goto("/edit.html");
  await openGitFolder(page, files);
  await page.locator('.tree-item[data-path="note.md"] .label').click();
  await page.locator('[data-editor-target="editor"] .cm-content').fill("long draft\n".repeat(180));
  const fileScroll = page.locator('[data-editor-target="editor"] .cm-scroller');
  await fileScroll.evaluate((element) => {
    element.scrollTop = 600;
  });
  await expect.poll(() => fileScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
  await page.getByRole("button", { name: "Изменения файла", exact: true }).click();
  const diffScroll = page.locator("#editor-diff-pane .cm-mergeView");
  await expect(diffScroll).toBeVisible();
  await diffScroll.evaluate((element) => {
    element.scrollTop = 700;
  });
  await expect.poll(() => diffScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(600);
  await page.getByRole("tab", { name: "note.md", exact: true }).click();
  await expect.poll(() => fileScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
  await page.getByRole("tab", { name: "note.md · изменения", exact: true }).click();
  await expect.poll(() => diffScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(600);
});
