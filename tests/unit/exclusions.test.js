import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mount, project, directory, fileHandle } from "../support/workspace.js";

let c, app;
beforeEach(async () => ({ c, app } = await mount()));
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search");
  app.stop();
});
it("excludes ignored paths before traversal, content reads, caching and search", async () => {
  const ignored = directory("node_modules", [fileHandle("secret.md", "needle")]);
  const git = directory(".git", [fileHandle("config", "needle")]);
  const log = fileHandle("drop.log", "needle");
  const nested = fileHandle("drop.md", "needle");
  const walk = vi.spyOn(ignored, "values");
  const gitWalk = vi.spyOn(git, "values");
  const read = vi.spyOn(log, "getFile");
  const nestedRead = vi.spyOn(nested, "getFile");
  await project(
    c,
    directory("N", [
      fileHandle(".gitignore", "node_modules/\n*.log\n!keep.log"),
      ignored,
      git,
      log,
      fileHandle("keep.log", "needle"),
      directory("Docs", [fileHandle(".gitignore", "drop.md"), nested, fileHandle("keep.md", "needle")]),
    ]),
  );
  c.tree.toggleExpand("Docs");
  c.reader.prefetchVisibleFiles(c.tree.treeRows.keys());
  c.search.searchDialogTarget.open = true;
  c.search.searchInputTarget.value = "needle";
  await c.search.runSearch(++c.search.searchVersion);
  expect([...c.project.nodes.keys()]).toEqual([
    ".gitignore",
    "keep.log",
    "Docs",
    "Docs/.gitignore",
    "Docs/keep.md",
  ]);
  expect(c.search.searchMatches.map((m) => m.path)).toEqual(["Docs/keep.md", "keep.log"]);
  expect(walk).not.toHaveBeenCalled();
  expect(gitWalk).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(nestedRead).not.toHaveBeenCalled();
});
it("filters uploaded folders without reading excluded file contents", async () => {
  const files = [
    new File(["ignored/\n*.log\n!keep.log"], ".gitignore"),
    new File(["secret"], "A.md"),
    new File(["keep"], "keep.log"),
    new File(["drop"], "drop.log"),
    new File(["!A.md"], ".gitignore"),
  ];
  for (const [index, path] of [
    "N/.gitignore",
    "N/ignored/A.md",
    "N/keep.log",
    "N/drop.log",
    "N/ignored/.gitignore",
  ].entries()) {
    Object.defineProperty(files[index], "webkitRelativePath", { value: path });
  }
  const read = vi.spyOn(files[1], "text");
  Object.defineProperty(c.directoryInputTarget, "files", { value: files });
  await c.importFiles({ target: c.directoryInputTarget });
  expect([...c.project.nodes.keys()]).toEqual([".gitignore", "keep.log"]);
  expect(read).not.toHaveBeenCalled();
});
it("stops scanning on unreadable ignore rules and can retry", async () => {
  const root = directory("N", [fileHandle(".gitignore", "ignored/"), directory("ignored")]);
  vi.spyOn(c.project, "loadIgnore").mockRejectedValueOnce(new Error("loader"));
  await expect(c.project.scanDirectory(root, "")).rejects.toThrow("loader");
  expect(c.project.nodes.size).toBe(0);
  expect(c.project.ignoreFactoryPromise).toBeNull();
  await c.project.scanDirectory(root, "");
  expect([...c.project.nodes.keys()]).toEqual([".gitignore"]);
});
it("applies scoped ignore rules when scanning a nested directory", async () => {
  await c.project.scanDirectory(
    directory("Docs", [fileHandle(".gitignore", "*.tmp"), fileHandle("a.tmp"), fileHandle("a.md")]),
    "Docs",
  );
  expect([...c.project.nodes.keys()]).toEqual(["Docs/.gitignore", "Docs/a.md"]);
});
