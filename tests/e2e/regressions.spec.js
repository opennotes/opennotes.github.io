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
