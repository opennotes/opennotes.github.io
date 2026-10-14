import { beforeEach, afterEach, it, expect, vi } from "vitest";

import { mount, fileHandle, directory, project } from "../support/workspace.js";

let c, app;
beforeEach(async () => {
  ({ c, app } = await mount());
});
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search");
  app.stop();
});
it("detects supported APIs, insecure contexts and local HTML separately", () => {
  const original = location;
  const load = vi.spyOn(c, "loadRecentWorkspace").mockResolvedValue();
  globalThis.showDirectoryPicker = vi.fn();
  delete globalThis.showOpenFilePicker;
  c.disconnect();
  c.connect();
  expect(c.apiOk).toBe(false);
  globalThis.showOpenFilePicker = vi.fn();
  vi.stubGlobal("isSecureContext", true);
  c.disconnect();
  c.connect();
  expect(c.apiOk).toBe(true);
  expect(load).toHaveBeenCalled();
  vi.stubGlobal("location", { protocol: "file:" });
  c.disconnect();
  c.connect();
  expect(c.apiOk).toBe(false);
  vi.stubGlobal("location", original);
  vi.stubGlobal("isSecureContext", false);
  c.disconnect();
  c.connect();
  expect(c.apiOk).toBe(false);
  delete globalThis.showDirectoryPicker;
  delete globalThis.showOpenFilePicker;
});
it("renders a scanned subtree without assuming root entries exist", async () => {
  await c.project.scanDirectory(directory("Sub", [fileHandle("A.md", "a")]), "Folder");
  c.prepareTree();
  c.tree.renderTree();
  expect(c.tree.treeRows.size).toBe(0);
});
it("clears active drop targets", async () => {
  await project(c, directory("Notes", [fileHandle("A.md", "a")]));
  const row = c.tree.treeRows.get("A.md");
  row.classList.add("drop-target");
  c.tree.clearDropTargets();
  expect(row.classList.contains("drop-target")).toBe(false);
});
it("opens image previews through the normal selection path", async () => {
  await project(c, directory("N", [fileHandle("A.png", "png", "image/png")]));
  await c.openNode("A.png");
  expect(c.editor.editorTarget.querySelector("object").type).toBe("image/png");
  expect(c.statusTextTarget.textContent).toBe("Просмотр");
});
it("opens a file in an already expanded directory", async () => {
  await project(c, directory("N", [directory("Folder", [fileHandle("A.md", "a")])]));
  c.tree.toggleExpand("Folder");
  await c.openNode("Folder/A.md");
  expect(c.tree.treeRows.get("Folder/A.md").getAttribute("aria-selected")).toBe("true");
});
it("retries a shared read if the file changes while that read is pending", async () => {
  const handle = fileHandle("A.md", "old");
  const get = handle.getFile.bind(handle);
  let release;
  handle.getFile = async () => {
    const f = await get();
    if (f.lastModified === 1) {
      f.text = () =>
        new Promise((resolve) => {
          release = () => resolve("old");
        });
    }
    return f;
  };
  const node = { handle };
  const first = c.reader.readNode(node);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  handle.change("changed");
  const second = c.reader.readNode(node);
  await Promise.resolve();
  await Promise.resolve();
  release();
  const awaitedResult1 = await first;
  expect(awaitedResult1.text).toBe("old");
  const awaitedResult2 = await second;
  expect(awaitedResult2.text).toBe("changed");
});
it("does not update a closed editor or a removed node after an in-flight save", async () => {
  await project(c, directory("N", [fileHandle("A.md", "a")]));
  await c.openNode("A.md");
  let release;
  const handle = c.project.fileHandle;
  handle.createWritable = async () => ({
    write: async () => {
      await new Promise((resolve) => {
        release = resolve;
      });
    },
    close: async () => {},
    abort: async () => {},
  });
  c.editor.view.dispatch({ changes: { from: 1, insert: " changed" } });
  const saving = c.editor.save();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  c.project.nodes.delete("A.md");
  c.editor.closeEditor();
  release();
  expect(await saving).toBe(true);
  expect(c.project.currentPath).toBeNull();
});
it("suppresses a failed save belonging to an editor that has closed", async () => {
  await project(c, directory("N", [fileHandle("A.md", "a")]));
  await c.openNode("A.md");
  let rejectSave;
  c.project.fileHandle.createWritable = () =>
    new Promise((resolve, reject) => {
      rejectSave = reject;
    });
  c.editor.view.dispatch({ changes: { from: 1, insert: " changed" } });
  const saving = c.editor.save();
  await vi.waitFor(() => expect(rejectSave).toBeTypeOf("function"));
  c.editor.closeEditor();
  rejectSave(new Error("late"));
  expect(await saving).toBe(false);
  expect(c.toastTarget.hidden).toBe(true);
});
it("matches directory names independently from file basenames", async () => {
  await project(c, directory("N", [directory("Needle", [fileHandle("A.md", "none")])]));
  c.search.searchDialogTarget.open = true;
  c.search.searchInputTarget.value = "needle";
  await c.search.runSearch(++c.search.searchVersion);
  expect(c.search.searchMatches[0].score).toBe(1);
});
it("discards results when the dialog closes during the final read", async () => {
  const h = fileHandle("A.md", "needle");
  h.getFile = async () => ({
    name: "A.md",
    type: "",
    size: 6,
    lastModified: 1,
    text: async () => {
      c.search.searchDialogTarget.open = false;
      return "needle";
    },
  });
  c.project.nodes.set("A.md", { kind: "file", name: "A.md", handle: h });
  c.search.searchDialogTarget.open = true;
  c.search.searchInputTarget.value = "needle";
  await c.search.runSearch(++c.search.searchVersion);
  expect(c.search.searchMatches).toBeUndefined();
});
it("supports a status without a category", () => {
  c.setStatus("Ready");
  expect(c.statusDotTarget.className).toBe("status-dot");
});
