import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mount, project, directory, fileHandle } from "../support/workspace.js";

let c, app;
beforeEach(async () => {
  ({ c, app } = await mount());
  await project(
    c,
    directory("Notes", [
      directory("Docs", [directory("Nested", [fileHandle("A.ts", "one\r\ntwo")])]),
      fileHandle("B.md", ""),
      fileHandle("photo.png", "image", "image/png"),
    ]),
  );
});
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search", "sidebar");
  app.stop();
  vi.unstubAllGlobals();
});

it("shows one-based cursor coordinates on opening, selection, editing and file switches", async () => {
  const position = c.editor.cursorPositionTarget;
  expect(position.hidden).toBe(true);
  await c.openNode("Docs/Nested/A.ts");
  expect(position.hidden).toBe(false);
  expect(position.textContent).toBe("Стр 1 · Стлб 1");
  const save = vi.spyOn(c.editor, "scheduleSave");
  c.editor.view.dispatch({ selection: { anchor: 0, head: 6 } });
  expect(position.textContent).toBe("Стр 2 · Стлб 3");
  c.editor.view.dispatch({ selection: { anchor: 6, head: 0 } });
  expect(position.textContent).toBe("Стр 1 · Стлб 1");
  expect(save).not.toHaveBeenCalled();
  c.editor.view.dispatch({ changes: { from: 0, insert: "\r\n" } });
  expect(position.textContent).toBe("Стр 2 · Стлб 1");
  await c.openNode("B.md");
  expect(position.textContent).toBe("Стр 1 · Стлб 1");
  c.editor.closeEditor();
  expect(position.hidden).toBe(true);
});

it("updates coordinates after disk reload and hides them for previews", async () => {
  await c.openNode("Docs/Nested/A.ts");
  c.editor.view.dispatch({ selection: { anchor: 7 } });
  c.editor.reloadDiskText("x");
  expect(c.editor.cursorPositionTarget.textContent).toBe("Стр 1 · Стлб 2");
  await c.openNode("photo.png");
  expect(c.editor.cursorPositionTarget.hidden).toBe(true);
  await c.openNode("B.md");
  expect(c.editor.cursorPositionTarget.hidden).toBe(false);
});

it("reveals collapsed ancestors and focuses the current row without reading or saving", async () => {
  await c.openNode("Docs/Nested/A.ts");
  c.tree.toggleExpand("Docs");
  const read = vi.spyOn(c.project.fileHandle, "getFile");
  const save = vi.spyOn(c.editor, "save");
  c.editor.view.dispatch({ changes: { from: 0, insert: "draft " }, selection: { anchor: 2 } });
  const state = c.editor.view.state;
  c.editor.pathLabelTarget.click();
  expect(c.tree.expanded.has("Docs")).toBe(true);
  expect(c.tree.expanded.has("Docs/Nested")).toBe(true);
  const row = c.tree.treeRows.get("Docs/Nested/A.ts");
  expect(document.activeElement).toBe(row);
  expect(row.getAttribute("aria-selected")).toBe("true");
  expect(row.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  expect(c.editor.view.state).toBe(state);
  expect(read).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(c.overlayTarget.classList.contains("open")).toBe(false);
});

it("opens the mobile drawer and keeps an already open drawer visible", async () => {
  vi.stubGlobal("innerWidth", 390);
  await c.openNode("B.md");
  c.editor.revealInTree();
  expect(c.sidebarTarget.classList.contains("open")).toBe(true);
  expect(c.overlayTarget.classList.contains("open")).toBe(true);
  c.editor.revealInTree();
  expect(c.sidebarTarget.classList.contains("open")).toBe(true);
});

it("ignores reveal without a current node or during file operations", async () => {
  const select = vi.spyOn(c.tree, "selectPath");
  c.editor.revealInTree();
  expect(select).not.toHaveBeenCalled();
  await c.openNode("B.md");
  select.mockClear();
  c.project.operationBusy = true;
  c.editor.revealInTree();
  expect(select).not.toHaveBeenCalled();
});
