import { expect, it, vi } from "vitest";

import { Project } from "../../src/js/files/project.js";
import { ProjectReader } from "../../src/js/files/reader.js";
import { fileHandle } from "../support/files.js";

it.each([true, false])(
  "shares one pending text read between search and opening (search first: %s)",
  async (searchFirst) => {
    const reader = new ProjectReader(new Project());
    const file = new File(["needle"], "A.md", { lastModified: 1 });
    let release;
    const read = vi.spyOn(file, "text").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const node = { name: "A.md", handle: { getFile: async () => file } };
    const first = searchFirst ? reader.readSearchText(node) : reader.readNode(node);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const second = searchFirst ? reader.readNode(node) : reader.readSearchText(node);
    await Promise.resolve();
    release("needle");
    const [a, b] = await Promise.all([first, second]);
    expect(searchFirst ? a : b).toBe("needle");
    expect(searchFirst ? b.text : a.text).toBe("needle");
    expect(read).toHaveBeenCalledTimes(1);
  },
);
it("does not replace newer cached text with an older in-flight read", async () => {
  const reader = new ProjectReader(new Project());
  const handle = fileHandle("A.md", "old");
  const node = { name: handle.name, handle };
  const oldFile = await handle.getFile();
  let release;
  vi.spyOn(oldFile, "text").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const old = reader.readText(node, oldFile);
  handle.change("new");
  const newFile = await handle.getFile();
  expect(await reader.readText(node, newFile)).toBe("new");
  release("old");
  expect(await old).toBe("old");
  expect(node.searchCache.text).toBe("new");
  expect(await reader.readSearchText(node)).toBe("new");
});
it("retries a failed text read rather than caching the rejected promise", async () => {
  const reader = new ProjectReader(new Project());
  const file = new File(["needle"], "A.md", { lastModified: 1 });
  const node = { name: file.name, handle: { getFile: async () => file } };
  vi.spyOn(file, "text").mockRejectedValueOnce(new Error("disk"));
  await expect(reader.readSearchText(node)).rejects.toThrow("disk");
  expect(await reader.readSearchText(node)).toBe("needle");
});
it("prunes cached previews and queued reads for files removed by rules", async () => {
  const project = new Project();
  const reader = new ProjectReader(project);
  const a = { name: "A.png", handle: fileHandle("A.png", "one", "image/png") };
  const b = { name: "B.png", handle: fileHandle("B.png", "two", "image/png") };
  project.nodes.set(a.name, a);
  project.nodes.set(b.name, b);
  await reader.readNode(a);
  await reader.readNode(b);
  reader.prefetchQueue = [a, b];
  project.nodes.delete(a.name);
  reader.prune();
  expect(reader.previewCache.has(a)).toBe(false);
  expect(reader.previewCache.has(b)).toBe(true);
  expect(reader.previewCacheBytes).toBe(3);
  expect(reader.prefetchQueue).toEqual([b]);
});
