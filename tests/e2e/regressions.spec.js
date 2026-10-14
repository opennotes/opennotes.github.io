import { test, expect } from "@playwright/test";

import files from "../scenarios/file-switch.js";
import mobile from "../scenarios/mobile-banner.js";
import cache from "../scenarios/read-cache.js";
import tree from "../scenarios/tree-performance.js";

const scenarios = Object.entries({ files, cache, tree, mobile });
for (const [name, run] of scenarios) {
  test(name, async ({ page }) => {
    const result = await run(page);
    expect(result).toBeTruthy();
  });
}
test("saved and renamed gitignore updates the native project through the UI", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  await page.goto("/edit.html");
  await page.waitForFunction(() => document.querySelector(".app")?.dataset.ready === "true");
  const name = `rules-${Date.now()}`;
  try {
    await page.evaluate(async (nameValue) => {
      const { application } = await import("/js/entries/editor.js");
      const c = application.getControllerForElementAndIdentifier(document.querySelector(".app"), "workspace");
      const storage = await navigator.storage.getDirectory();
      const root = await storage.getDirectoryHandle(nameValue, { create: true });
      const docs = await root.getDirectoryHandle("Docs", { create: true });
      for (const [parent, filename, text] of [
        [root, ".gitignore", ""],
        [docs, "A.md", "needle"],
      ]) {
        // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
        const file = await parent.getFileHandle(filename, { create: true });
        // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
        const writer = await file.createWritable();
        // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
        await writer.write(text);
        // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
        await writer.close();
      }
      c.dismissBanner();
      c.apiOk = false;
      c.project.dirHandle = root;
      c.project.workspaceIsDirectory = true;
      await c.project.scanDirectory(root, "");
      c.prepareTree();
      c.tree.renderTree();
    }, name);
    await page.locator('.tree-item[data-path=".gitignore"] .label').click();
    await page.locator(".cm-content").fill("Docs/");
    await expect(page.locator('.tree-item[data-path="Docs"]')).toHaveCount(0);
    await page.locator('.tree-item[data-path=".gitignore"]').focus();
    await page.keyboard.press("F2");
    await page.locator('[data-tree-target="actionInput"]').fill("rules.txt");
    await page.locator('[data-tree-target="actionSubmit"]').click();
    await expect(page.locator('.tree-item[data-path="Docs"]')).toBeVisible();
    await page.locator('.tree-item[data-path="Docs"] .label').click();
    await page.locator('.tree-item[data-path="Docs/A.md"] .label').click();
    await expect(page.locator(".cm-content")).toHaveText("needle");
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(async (nameValue) => {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(nameValue, { recursive: true });
    }, name);
  }
});

test("opening a native file announces the read without loading its neighbours", async ({ page }) => {
  await page.goto("/edit.html");
  await page.waitForFunction(() => document.querySelector(".app")?.dataset.ready === "true");
  await page.evaluate(async () => {
    const { application } = await import("/js/entries/editor.js");
    const c = application.getControllerForElementAndIdentifier(document.querySelector(".app"), "workspace");
    c.dismissBanner();
    c.apiOk = false;
    c.project.dirHandle = {};
    globalThis.diskReads = [];
    for (const name of ["Selected.md", "Neighbour.md"]) {
      const handle = {
        getFile() {
          globalThis.diskReads.push(name);
          return new Promise((resolve) => {
            globalThis.finishDiskRead = () => resolve(new File(["Small note"], name));
          });
        },
      };
      c.project.nodes.set(name, { kind: "file", name, parentPath: "", handle });
    }
    c.prepareTree();
    c.tree.renderTree();
  });
  await expect(page.locator('[data-workspace-target="opening"]')).toBeHidden();
  await page.locator('.tree-item[data-path="Selected.md"] .label').click();
  await expect(page.locator('[data-workspace-target="opening"]')).toHaveText("Открываем Selected.md…");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "true");
  expect(await page.evaluate(() => globalThis.diskReads)).toEqual(["Selected.md"]);
  await page.evaluate(() => globalThis.finishDiskRead());
  await expect(page.locator(".cm-content")).toHaveText("Small note");
  await expect(page.locator('[data-workspace-target="opening"]')).toBeHidden();
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
});

test("Native project opening preserves line endings and blocks stale autosaves", async ({ page }) => {
  await page.goto("/edit.html");
  await expect(page.locator(".app")).toHaveAttribute("data-ready", "true");
  const directoryName = `external-changes-${Date.now()}`;
  try {
    const result = await page.evaluate(async (name) => {
      const { application } = await import("/js/entries/editor.js");
      const c = application.getControllerForElementAndIdentifier(document.querySelector(".app"), "workspace");
      const storage = await navigator.storage.getDirectory();
      const root = await storage.getDirectoryHandle(name, { create: true });
      const handle = await root.getFileHandle("A.md", { create: true });
      const initial = "one\r\ntwo";
      const writer = await handle.createWritable();
      await writer.write(initial);
      await writer.close();
      await c.loadNativeWorkspace(root);
      await c.openNode("A.md");
      await c.editor.save();
      const unchangedFile = await handle.getFile();
      const afterOpening = await unchangedFile.text();
      c.editor.view.dispatch({ changes: { from: 0, insert: "browser " } });
      c.editor.cancelSave();
      const external = await handle.createWritable();
      await external.write("external version");
      await external.close();
      const saved = await c.editor.save();
      const currentFile = await handle.getFile();
      return {
        afterOpening,
        saved,
        disk: await currentFile.text(),
        draft: c.editor.view.state.sliceDoc(),
      };
    }, directoryName);
    expect(result).toEqual({
      afterOpening: "one\r\ntwo",
      saved: false,
      disk: "external version",
      draft: "browser one\r\ntwo",
    });
    await expect(page.locator('[data-workspace-target="toast"]')).toContainText("Файл изменён вне редактора");
    await expect(page.locator('[data-editor-target="download"]')).toBeVisible();
    await expect(page.locator(".cm-line")).toHaveText(["browser one", "two"]);
  } finally {
    await page.evaluate(async (name) => {
      const storage = await navigator.storage.getDirectory();
      await storage.removeEntry(name, { recursive: true });
    }, directoryName);
  }
});
