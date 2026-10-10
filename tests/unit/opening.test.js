import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { directory, fileHandle, mount, project } from "../support/workspace.js";

let c, app;
beforeEach(async () => {
  ({ c, app } = await mount());
});
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search");
  app.stop();
});
it("announces native project loading before scanning and clears feedback after failure", async () => {
  let fail;
  vi.spyOn(c.project, "scanDirectory").mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        fail = reject;
      }),
  );
  const loading = c.loadNativeWorkspace(directory("Notes", []));
  expect(c.openingTarget.hidden).toBe(false);
  expect(c.openingTarget.textContent).toBe("Открываем Notes…");
  expect(c.contentTarget.getAttribute("aria-busy")).toBe("true");
  fail(new Error("disk"));
  await expect(loading).rejects.toThrow("disk");
  expect(c.openingTarget.hidden).toBe(true);
  expect(c.contentTarget.getAttribute("aria-busy")).toBe("false");
});
it("keeps the newest file feedback while an older selection completes", async () => {
  const a = fileHandle("A.md", "Alpha");
  const b = fileHandle("B.md", "Beta");
  await project(c, directory("Notes", [a, b]));
  const fa = await a.getFile();
  const fb = await b.getFile();
  let releaseA, releaseB;
  vi.spyOn(a, "getFile").mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseA = resolve;
      }),
  );
  vi.spyOn(b, "getFile").mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseB = resolve;
      }),
  );
  const first = c.openNode("A.md");
  const second = c.openNode("B.md");
  expect(c.openingTarget.textContent).toBe("Открываем B.md…");
  releaseA(fa);
  await first;
  expect(c.openingTarget.hidden).toBe(false);
  expect(c.project.currentPath).toBeNull();
  releaseB(fb);
  await second;
  expect(c.project.currentPath).toBe("B.md");
  expect(c.openingTarget.hidden).toBe(true);
});
it("cancels feedback when returning to the current file and prevents a stale switch", async () => {
  await project(c, directory("Notes", [fileHandle("A.md", "Alpha"), fileHandle("B.md", "Beta")]));
  await c.openNode("A.md");
  const b = c.project.nodes.get("B.md");
  const file = await b.handle.getFile();
  let release;
  vi.spyOn(b.handle, "getFile").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = c.openNode("B.md");
  await c.openNode("A.md");
  expect(c.openingTarget.hidden).toBe(true);
  release(file);
  await pending;
  expect(c.project.currentPath).toBe("A.md");
});
it("clears file feedback and reports an opening error without calling it saving", async () => {
  await project(c, directory("Notes", [fileHandle("A.md", "Alpha")]));
  vi.spyOn(c.project.nodes.get("A.md").handle, "getFile").mockRejectedValue(new Error("disk"));
  await c.openNode("A.md");
  expect(c.openingTarget.hidden).toBe(true);
  expect(c.statusTextTarget.textContent).toBe("Ошибка чтения");
});
