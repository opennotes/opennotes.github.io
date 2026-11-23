/* eslint security/detect-non-literal-fs-filename: "off" -- All filesystem writes stay in the disposable mkdtemp repository. */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { test, expect } from "@playwright/test";

import { startGitServer } from "../../src/public/open-notes-git.mjs";

let helper;
let root;

function git(args) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- Exercise the installed Git with an isolated temporary repository.
  execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
}

test.beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "open-notes-git-ui-"));
  git(["init", "-b", "main"]);
  git(["config", "user.name", "Test Author"]);
  git(["config", "user.email", "test@example.test"]);
  await writeFile(path.join(root, "note.md"), "before\n");
  await writeFile(path.join(root, "deleted.md"), "gone\n");
  git(["add", "."]);
  git(["commit", "-m", "Initial notes"]);
  await writeFile(path.join(root, "note.md"), "staged\n");
  git(["add", "note.md"]);
  await writeFile(path.join(root, "note.md"), "working\n");
  await writeFile(path.join(root, "new note.md"), "new note\n");
  await unlink(path.join(root, "deleted.md"));
  helper = await startGitServer(root);
});

test.afterAll(async () => {
  if (helper) {
    await new Promise((resolve) => {
      helper.server.close(resolve);
    });
  }
  if (root) {
    await rm(root, { recursive: true, force: true });
  }
});

test("Native Git shows the branch, all disk changes, both diffs and commit history", async ({ page }) => {
  await page.goto(`/edit.html#git=${encodeURIComponent(helper.connection)}`);
  const dialog = page.getByRole("dialog", { name: "Git", exact: true });
  const patch = dialog.getByRole("region", { name: "Просмотр различий" });
  await expect(page.locator('[data-git-target="launch"]')).toHaveText("Git · main");
  await expect(page.locator('[data-git-target="repository"]')).toContainText("open-notes-git-ui-");
  await dialog.locator('[data-area="working"][data-path="note.md"]').click();
  await expect(patch).toContainText("-staged");
  await expect(patch).toContainText("+working");
  await dialog.locator('[data-area="staged"][data-path="note.md"]').click();
  await expect(patch).toContainText("-before");
  await expect(patch).toContainText("+staged");
  await dialog.locator('[data-area="working"][data-path="deleted.md"]').click();
  await expect(patch).toContainText("-gone");
  await dialog.locator('[data-area="untracked"][data-path="new note.md"]').click();
  await expect(patch).toContainText("+new note");
  await dialog.getByRole("button", { name: /Initial notes/ }).click();
  await expect(patch).toContainText("+before");
  await writeFile(path.join(root, "note.md"), "updated on disk\n");
  await dialog.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(dialog.locator('[data-git-target="status"]')).toBeEmpty();
  await dialog.locator('[data-area="working"][data-path="note.md"]').click();
  await expect(patch).toContainText("+updated on disk");
  await dialog.getByRole("button", { name: "Отключить", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Подключить", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Закрыть · Esc", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test("Native Git remains usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/edit.html#git=${encodeURIComponent(helper.connection)}`);
  await expect(page.locator('[data-git-target="launch"]')).toHaveText("Git · main");
  const dialog = page.getByRole("dialog", { name: "Git", exact: true });
  await dialog.locator('[data-area="working"][data-path="note.md"]').click();
  await expect(dialog.locator(".git-patch")).toContainText("diff --git");
  const fits = await dialog.evaluate((element) => element.getBoundingClientRect().right <= innerWidth);
  expect(fits).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
