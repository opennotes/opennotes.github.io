import { EditorState } from "@codemirror/state";
import { expect, it } from "vitest";

import { DiffView } from "../../src/js/git/diff-view.js";

const CONTENTS = { path: "note.md", before: "before\nunchanged\nold\n", after: "after\nunchanged\nnew\n" };

it("shows immutable aligned versions in a shared comparison viewport", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const diff = new DiffView(parent, CONTENTS, false);
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
  const diff = new DiffView(parent, CONTENTS, true);
  expect(diff.view.state.doc.toString()).toBe(CONTENTS.after);
  expect(diff.view.state.facet(EditorState.readOnly)).toBe(true);
  expect(parent.querySelector(".cm-merge-revert")).toBeNull();
  diff.destroy();
});
