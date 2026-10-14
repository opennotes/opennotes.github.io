import { undo } from "@codemirror/commands";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { loadLineNumbers, storeLineNumbers } from "../../src/js/editor/preferences.js";
import { mount, project, directory, fileHandle } from "../support/workspace.js";

let c, app;
beforeEach(async () => {
  localStorage.clear();
  ({ c, app } = await mount());
  await project(c, directory("Notes", [fileHandle("A.js", "one\ntwo"), fileHandle("B.md", "# Heading")]));
});
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search", "sidebar");
  app.stop();
  localStorage.clear();
});

it("defaults to hidden and ignores toggling without a document", async () => {
  c.editor.toggleLineNumbers();
  expect(loadLineNumbers()).toBe(false);
  await c.openNode("A.js");
  expect(c.editor.editorTarget.querySelector(".cm-lineNumbers")).toBeNull();
  expect(c.editor.lineNumbersTarget.getAttribute("aria-pressed")).toBe("false");
  expect(c.editor.lineNumbersTarget.disabled).toBe(false);
});

it("toggles without changing the draft, selection, undo history or saving", async () => {
  await c.openNode("A.js");
  c.editor.view.dispatch({ changes: { from: 0, insert: "edited " }, selection: { anchor: 2, head: 4 } });
  const save = vi.spyOn(c.editor, "scheduleSave");
  const selection = c.editor.view.state.selection;
  c.editor.toggleLineNumbers();
  expect(c.editor.editorTarget.querySelector(".cm-lineNumbers")).not.toBeNull();
  expect(c.editor.lineNumbersTarget.getAttribute("aria-pressed")).toBe("true");
  expect(c.editor.view.state.doc.toString()).toBe("edited one\ntwo");
  expect(c.editor.view.state.selection.eq(selection)).toBe(true);
  expect(save).not.toHaveBeenCalled();
  expect(loadLineNumbers()).toBe(true);
  c.editor.toggleLineNumbers();
  expect(c.editor.editorTarget.querySelector(".cm-lineNumbers")).toBeNull();
  expect(loadLineNumbers()).toBe(false);
  undo(c.editor.view);
  expect(c.editor.view.state.doc.toString()).toBe("one\ntwo");
});

it("keeps the preference across file switches and controller reloads", async () => {
  await c.openNode("A.js");
  c.editor.toggleLineNumbers();
  await c.openNode("B.md");
  expect(c.editor.editorTarget.querySelector(".cm-lineNumbers")).not.toBeNull();
  app.unload("workspace", "tree", "editor", "search", "sidebar");
  app.stop();
  ({ c, app } = await mount());
  c.project.fileHandle = { name: "new.json" };
  c.editor.showEditor("{}");
  expect(c.editor.editorTarget.querySelector(".cm-lineNumbers")).not.toBeNull();
  expect(c.editor.lineNumbersTarget.getAttribute("aria-pressed")).toBe("true");
});

it("uses the default when storage cannot be read", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(loadLineNumbers()).toBe(false);
});

it("still toggles when storage is full or blocked", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  expect(() => storeLineNumbers(true)).not.toThrow();
  await c.openNode("A.js");
  c.editor.toggleLineNumbers();
  expect(c.editor.editorTarget.querySelector(".cm-lineNumbers")).not.toBeNull();
  expect(c.editor.lineNumbersTarget.getAttribute("aria-pressed")).toBe("true");
});
