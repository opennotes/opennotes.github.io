import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mount, project, directory, fileHandle } from "../support/workspace.js";

let c, app;
beforeEach(async () => ({ c, app } = await mount()));
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search");
  app.stop();
});
it("shares one project and reader while controllers own their UI", async () => {
  expect(
    app.controllers.map((controller) => controller.identifier).toSorted((a, b) => a.localeCompare(b)),
  ).toEqual(["editor", "search", "tree", "workspace"]);
  expect(c.editor.project).toBe(c.project);
  expect(c.tree.project).toBe(c.project);
  expect(c.search.project).toBe(c.project);
  expect(c.reader.project).toBe(c.project);
  await project(c, directory("N", [fileHandle("A.md", "first"), fileHandle("B.md", "second")]));
  c.tree.treeRows.get("A.md").click();
  await vi.waitFor(() => expect(c.project.currentPath).toBe("A.md"));
  c.editor.bold();
  c.tree.treeRows.get("B.md").click();
  await vi.waitFor(() => expect(c.project.currentPath).toBe("B.md"));
  const awaitedResult1 = await c.project.nodes.get("A.md").handle.getFile();
  expect(await awaitedResult1.text()).toContain("**жирный**");
});
it("detaches listeners and editor on removal and reconnects without duplicating shortcuts", async () => {
  await project(c, directory("N", [fileHandle("A.md", "first")]));
  await c.openNode("A.md");
  const element = c.element;
  const editor = c.editor;
  const search = c.search;
  const open = vi.spyOn(search, "openSearch");
  element.remove();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  expect(editor.view).toBeNull();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
  expect(open).not.toHaveBeenCalled();
  document.body.append(element);
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(c.editor.project).toBe(c.project);
  c.search.closeSearch();
  c.tree.treeRows.get("A.md").click();
  await vi.waitFor(() => expect(c.editor.view?.state.doc.toString()).toBe("first"));
});
it("stops a document save when its editor disappears during a write", async () => {
  await project(c, directory("N", [fileHandle("A.md", "first")]));
  await c.openNode("A.md");
  let release;
  c.project.fileHandle.createWritable = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  c.editor.view.dispatch({ changes: { from: 0, insert: "new " } });
  clearTimeout(c.editor.saveTimer);
  const saving = c.editor.save();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  c.editor.view.destroy();
  c.editor.view = null;
  release({ write: async () => {}, close: async () => {} });
  expect(await saving).toBe(true);
});
it("resolves declared outlets and applies configured state classes without replacing structural styles", async () => {
  expect(c.treeOutlet).toBe(c.tree);
  expect(c.editorOutlet).toBe(c.editor);
  expect(c.searchOutlet).toBe(c.search);
  expect(c.tree.workspaceOutlet).toBe(c);
  expect(c.editor.workspaceOutlet).toBe(c);
  expect(c.search.workspaceOutlet).toBe(c);
  c.element.dataset.workspaceOpenClass = "drawer-open overlay-open";
  c.toggleSidebar();
  expect(c.sidebarTarget.classList.contains("drawer-open")).toBe(true);
  expect(c.overlayTarget.classList.contains("overlay-open")).toBe(true);
  c.toggleSidebar();
  expect(c.sidebarTarget.classList.contains("drawer-open")).toBe(false);
  c.toggleSidebar();
  c.closeSidebar();
  expect(c.overlayTarget.classList.contains("overlay-open")).toBe(false);
  c.element.dataset.workspaceSavedClass = "persisted success";
  c.statusDotTarget.classList.add("custom-dot");
  c.setStatus("Saved", "saved");
  expect(c.statusDotTarget.classList.contains("persisted")).toBe(true);
  expect(c.statusDotTarget.classList.contains("success")).toBe(true);
  c.setStatus("Saving", "saving");
  expect(c.statusDotTarget.classList.contains("persisted")).toBe(false);
  expect(c.statusDotTarget.classList.contains("custom-dot")).toBe(true);
});
it("uses configured tree and preview classes for selection and drag feedback", async () => {
  c.element.dataset.treeActiveClass = "selected highlighted";
  c.element.dataset.treeDropTargetClass = "drag-hover drop-hover";
  c.element.dataset.editorPreviewClass = "media-preview file-preview";
  await project(c, directory("N", [fileHandle("A.md", "first")]));
  await c.openNode("A.md");
  const row = c.tree.treeRows.get("A.md");
  expect(row.classList.contains("selected")).toBe(true);
  row.classList.add("drag-hover", "drop-hover");
  c.tree.clearDropTargets();
  expect(row.classList.contains("drag-hover")).toBe(false);
  expect(row.classList.contains("drop-hover")).toBe(false);
  c.editor.showObjectPreview(new File(["image"], "image.png", { type: "image/png" }), "image/png");
  expect(c.editor.toolbarTarget.classList.contains("media-preview")).toBe(true);
  expect(c.editor.toolbarTarget.classList.contains("file-preview")).toBe(true);
  c.editor.showEditor("text");
  expect(c.editor.toolbarTarget.classList.contains("media-preview")).toBe(false);
});
