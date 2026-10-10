import { expect, it, vi } from "vitest";

import { IgnoreFileCache } from "../../src/js/files/ignore-cache.js";
import { directory, fileHandle, mount } from "../support/workspace.js";

it("reuses rules after a restart only while native metadata still matches", async () => {
  const handle = fileHandle(".gitignore", "private/");
  const original = new IgnoreFileCache();
  expect(await original.read(".gitignore", handle)).toBe("private/");
  const cached = new IgnoreFileCache(original.snapshot());
  const file = await handle.getFile();
  const read = vi.spyOn(file, "text");
  vi.spyOn(handle, "getFile").mockResolvedValueOnce(file);
  expect(await cached.read(".gitignore", handle)).toBe("private/");
  expect(read).not.toHaveBeenCalled();
  handle.change("public/ ");
  expect(await cached.read(".gitignore", handle)).toBe("public/ ");
});
it("detects size changes even if the modification time is unchanged", async () => {
  const first = new File(["A"], ".gitignore", { lastModified: 1 });
  const next = new File(["BB"], ".gitignore", { lastModified: 1 });
  const handle = { getFile: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next) };
  const cache = new IgnoreFileCache();
  await cache.read(".gitignore", handle);
  expect(await cache.read(".gitignore", handle)).toBe("BB");
});
it("does not store failed rule reads", async () => {
  const file = new File(["A"], ".gitignore");
  const handle = { getFile: async () => file };
  vi.spyOn(file, "text").mockRejectedValueOnce(new Error("disk"));
  const cache = new IgnoreFileCache();
  await expect(cache.read(".gitignore", handle)).rejects.toThrow("disk");
  expect(cache.snapshot()).toEqual([]);
  expect(await cache.read(".gitignore", handle)).toBe("A");
});
it("restores rules for the remembered project without reading excluded files", async () => {
  const { app, c } = await mount();
  try {
    const rules = fileHandle(".gitignore", "private/");
    const secret = fileHandle("secret.md", "excluded");
    const root = directory("Notes", [rules, directory("private", [secret])]);
    await c.loadNativeWorkspace(root);
    c.apiOk = true;
    c.rememberWorkspace();
    const recent = c.recentWorkspace;
    const snapshot = await rules.getFile();
    const read = vi.spyOn(snapshot, "text");
    vi.spyOn(rules, "getFile").mockResolvedValueOnce(snapshot);
    const hiddenRead = vi.spyOn(secret, "getFile");
    await c.resumeWorkspace();
    expect(c.recentWorkspace.ignores).toEqual(recent.ignores);
    expect(read).not.toHaveBeenCalled();
    expect(hiddenRead).not.toHaveBeenCalled();
    expect(c.project.nodes.has("private")).toBe(false);
    await c.loadNativeWorkspace(directory("Other", [fileHandle(".gitignore", "different")]));
    expect(c.ignoreFiles.snapshot()[0][1].text).toBe("different");
  } finally {
    app.unload("workspace", "tree", "editor", "search");
    app.stop();
  }
});
