import { undo } from "@codemirror/commands";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mount, project, directory, fileHandle } from "../support/workspace.js";

let c, app, handle, visibility;
beforeEach(async () => {
  visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  ({ c, app } = await mount());
  handle = fileHandle("A.md", "original text");
  await project(c, directory("Notes", [handle, fileHandle("B.md", "other")]));
  await c.openNode("A.md");
});
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search", "sidebar");
  app.stop();
});
async function delayedRead() {
  handle.change("external version");
  const file = await handle.getFile();
  let resolveRead, rejectRead;
  const getFile = vi.spyOn(handle, "getFile").mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        resolveRead = resolve;
        rejectRead = reject;
      }),
  );
  const pending = c.editor.refreshFromDisk();
  return {
    pending,
    release: () => resolveRead(file),
    fail: () => rejectRead(new Error("disk")),
    getFile,
  };
}

it("reloads on tab visibility and does not write or read while hidden", async () => {
  const getFile = vi.spyOn(handle, "getFile");
  const write = vi.spyOn(handle, "createWritable");
  handle.change("external version");
  visibility.mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(getFile).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(c.editor.view.state.doc.toString()).toBe("external version"));
  expect(write).not.toHaveBeenCalled();
  expect(c.editor.editorSession.diskText).toBe("external version");
  expect(c.statusTextTarget.textContent).toBe("Обновлено с диска");
});

it("reloads on window focus and detaches listeners on removal", async () => {
  handle.change("focused version");
  dispatchEvent(new Event("focus"));
  await vi.waitFor(() => expect(c.editor.view.state.doc.toString()).toBe("focused version"));
  app.unload("editor");
  const getFile = vi.spyOn(handle, "getFile");
  dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(getFile).not.toHaveBeenCalled();
});

it("keeps unchanged state and undo history and bypasses metadata caches", async () => {
  const state = c.editor.view.state;
  await c.editor.refreshFromDisk();
  expect(c.editor.view.state).toBe(state);
  const snapshot = await handle.getFile();
  vi.spyOn(handle, "getFile").mockResolvedValue(
    new File(["external text"], "A.md", { lastModified: snapshot.lastModified }),
  );
  await c.editor.refreshFromDisk();
  expect(c.editor.view.state.doc.toString()).toBe("external text");
  expect(undo(c.editor.view)).toBe(false);
});

it("skips unsaved drafts and in-flight saves", async () => {
  const read = vi.spyOn(handle, "getFile");
  c.editor.editorSession.promise = Promise.resolve(true);
  await c.editor.refreshFromDisk();
  c.editor.editorSession.promise = null;
  c.editor.view.dispatch({ changes: { from: 0, insert: "draft " } });
  c.editor.cancelSave();
  handle.change("external version");
  await c.editor.refreshFromDisk();
  expect(read).not.toHaveBeenCalled();
  expect(c.editor.view.state.doc.toString()).toBe("draft original text");
});

it("skips busy operations, opening, static uploads and absent sessions", async () => {
  const read = vi.spyOn(handle, "getFile");
  c.project.operationBusy = true;
  await c.editor.refreshFromDisk();
  c.project.operationBusy = false;
  c.openingTarget.hidden = false;
  await c.editor.refreshFromDisk();
  c.openingTarget.hidden = true;
  c.editor.editorSession.handle = {};
  await c.editor.refreshFromDisk();
  c.editor.editorSession.handle = null;
  await c.editor.refreshFromDisk();
  c.editor.editorSession = null;
  await c.editor.refreshFromDisk();
  c.editor.closeEditor();
  await c.editor.refreshFromDisk();
  expect(read).not.toHaveBeenCalled();
});

it("deduplicates focus and visibility events while a read is pending", async () => {
  const read = await delayedRead();
  dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(read.getFile).toHaveBeenCalledOnce();
  read.release();
  await read.pending;
  expect(c.editor.view.state.doc.toString()).toBe("external version");
  expect(c.editor.refreshPromise).toBeNull();
});

it.each([false, true])("keeps edits made during reading even if undone: %s", async (shouldUndo) => {
  const read = await delayedRead();
  c.editor.view.dispatch({ changes: { from: 0, insert: "typed " } });
  if (shouldUndo) {
    undo(c.editor.view);
  }
  c.editor.cancelSave();
  read.release();
  await read.pending;
  expect(c.editor.view.state.doc.toString()).toBe(shouldUndo ? "original text" : "typed original text");
});

it("does not replace another file after a switch", async () => {
  const read = await delayedRead();
  await c.openNode("B.md");
  read.release();
  await read.pending;
  expect(c.editor.view.state.doc.toString()).toBe("other");
});

it("discards a read when opening starts or the handle is renamed", async () => {
  const read = await delayedRead();
  c.openVersion++;
  read.release();
  await read.pending;
  const second = await delayedRead();
  c.editor.editorSession.handle = c.project.nodes.get("B.md").handle;
  second.release();
  await second.pending;
  expect(c.editor.view.state.doc.toString()).toBe("original text");
});

it("ignores a read finishing after disconnect", async () => {
  const editor = c.editor;
  const read = await delayedRead();
  app.unload("editor");
  read.release();
  await read.pending;
  expect(editor.view).toBeNull();
  expect(editor.refreshPromise).toBeNull();
});

it("preserves latest cursor position, scroll and dialog focus and refreshes search", async () => {
  handle.change("new");
  c.search.openSearch();
  const search = vi.spyOn(c.search, "queueSearch");
  c.editor.view.dispatch({ selection: { anchor: 9, head: 12 } });
  c.editor.view.scrollDOM.scrollTop = 40;
  c.editor.view.scrollDOM.scrollLeft = 20;
  c.search.searchInputTarget.focus();
  const focused = document.activeElement;
  await c.editor.refreshFromDisk();
  expect(c.editor.view.state.selection.main.anchor).toBe(3);
  expect(c.editor.view.state.selection.main.head).toBe(3);
  expect(c.editor.view.scrollDOM.scrollTop).toBe(40);
  expect(c.editor.view.scrollDOM.scrollLeft).toBe(20);
  expect(document.activeElement).toBe(focused);
  expect(search).toHaveBeenCalledOnce();
});

it("preserves new line endings and uses the refreshed baseline for later edits", async () => {
  handle.change("one\r\ntwo");
  await c.editor.refreshFromDisk();
  c.editor.view.dispatch({ changes: { from: 0, insert: "edited " } });
  c.editor.cancelSave();
  expect(await c.editor.save()).toBe(true);
  const file = await handle.getFile();
  expect(await file.text()).toBe("edited one\r\ntwo");
});

it("reports read failures without losing text and retries on the next activation", async () => {
  vi.spyOn(handle, "getFile").mockRejectedValueOnce(new Error("disk"));
  await c.editor.refreshFromDisk();
  expect(c.toastTarget.textContent).toBe("Не удалось обновить файл: disk");
  expect(c.editor.view.state.doc.toString()).toBe("original text");
  handle.change("retry version");
  await c.editor.refreshFromDisk();
  expect(c.editor.view.state.doc.toString()).toBe("retry version");
});

it.each(["switch", "edit"])("suppresses failures after %s", async (action) => {
  const read = await delayedRead();
  const actions = new Map([
    ["switch", () => c.openNode("B.md")],
    ["edit", () => c.editor.view.dispatch({ changes: { from: 0, insert: "draft " } })],
  ]);
  await actions.get(action)();
  c.editor.cancelSave();
  const toast = vi.spyOn(c, "showToast");
  read.fail();
  await read.pending;
  expect(toast).not.toHaveBeenCalled();
});

it("updates project rules when an externally edited gitignore is refreshed", async () => {
  const rules = fileHandle(".gitignore", "");
  await project(c, directory("Notes", [rules, fileHandle("A.md", "note")]));
  await c.openNode(".gitignore");
  rules.change("A.md");
  await c.editor.refreshFromDisk();
  await vi.waitFor(() => expect(c.project.nodes.has("A.md")).toBe(false));
});

it("lets the new file refresh while an old read is still pending", async () => {
  const oldRead = await delayedRead();
  await c.openNode("B.md");
  const nextHandle = c.project.fileHandle;
  nextHandle.change("new B");
  const file = await nextHandle.getFile();
  let release;
  vi.spyOn(nextHandle, "getFile").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const refreshing = c.editor.refreshFromDisk();
  const pending = c.editor.refreshPromise;
  oldRead.release();
  await oldRead.pending;
  expect(c.editor.refreshPromise).toBe(pending);
  release(file);
  await refreshing;
  expect(c.editor.view.state.doc.toString()).toBe("new B");
});
