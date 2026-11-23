import { EditorState } from "@codemirror/state";
import { expect, it } from "vitest";

import { DiffView } from "../../src/js/git/diff-view.js";

const CONTENTS = { path: "note.md", before: "before\nunchanged\nold\n", after: "after\nunchanged\nnew\n" };

it("shows immutable aligned versions in a shared comparison viewport", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const diff = new DiffView(parent, CONTENTS, { isUnified: false, hasWrapping: true });
  expect(diff.merge.a.state.doc.toString()).toBe(CONTENTS.before);
  expect(diff.merge.b.state.doc.toString()).toBe(CONTENTS.after);
  expect(diff.merge.a.state.facet(EditorState.readOnly)).toBe(true);
  expect(diff.merge.b.state.facet(EditorState.readOnly)).toBe(true);
  diff.navigate(false);
  diff.navigate(true);
  diff.destroy();
  expect(parent.childElementCount).toBe(0);
});

it("renders an inline read-only comparison without merge or accept controls", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const diff = new DiffView(parent, CONTENTS, { isUnified: true, hasWrapping: false });
  expect(diff.view.state.doc.toString()).toBe(CONTENTS.after);
  expect(diff.view.state.facet(EditorState.readOnly)).toBe(true);
  expect(parent.querySelector(".cm-merge-revert")).toBeNull();
  diff.destroy();
});

it("starts at the first changed block and reports its position while navigating", () => {
  const unchanged = "unchanged line\n".repeat(24);
  const data = { path: "code.js", before: `before\n${unchanged}old\n`, after: `after\n${unchanged}new\n` };
  const parent = document.createElement("div");
  document.body.append(parent);
  const diff = new DiffView(parent, data, { isUnified: false, hasWrapping: false, onSelection: () => {} });
  expect(diff.position).toEqual({ current: 1, total: 2 });
  diff.navigate(false);
  expect(diff.position).toEqual({ current: 2, total: 2 });
  diff.destroy();
});

it("handles identical text without creating fake changed-block positions", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const diff = new DiffView(
    parent,
    { path: "empty.md", before: "same", after: "same" },
    { isUnified: true, hasWrapping: true },
  );
  expect(diff.position).toEqual({ current: 0, total: 0 });
  diff.destroy();
});
