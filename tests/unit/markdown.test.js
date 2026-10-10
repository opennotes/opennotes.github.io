import { EditorState } from "@codemirror/state";
import { it, expect } from "vitest";

import {
  headingLineDecorations,
  markdownMarkerDecorations,
  markdownHighlightStyle,
} from "../../src/js/editor/markdown.js";

it("decorates headings and updates them only for document edits", () => {
  let state = EditorState.create({ doc: "# One\n## Two\nplain", extensions: [headingLineDecorations] });
  expect(state.field(headingLineDecorations).size).toBe(2);
  const previous = state.field(headingLineDecorations);
  state = state.update({ selection: { anchor: 2 } }).state;
  expect(state.field(headingLineDecorations)).toBe(previous);
  state = state.update({ changes: { from: 0, to: state.doc.length, insert: "plain" } }).state;
  expect(state.field(headingLineDecorations).size).toBe(0);
  expect(markdownHighlightStyle.specs.length).toBeGreaterThan(10);
});
it("decorates visible markers and code fences and responds to viewport changes", () => {
  const state = EditorState.create({ doc: "# H\n> quote\n- list\n```js\ncode\n```\nnone" });
  const view = { state, visibleRanges: [{ from: 0, to: state.doc.length }] };
  const plugin = markdownMarkerDecorations.create(view);
  expect(plugin.decorations.size).toBe(5);
  const previous = plugin.decorations;
  plugin.update({ docChanged: false, viewportChanged: false, view });
  expect(plugin.decorations).toBe(previous);
  plugin.update({ docChanged: false, viewportChanged: true, view });
  expect(plugin.decorations).not.toBe(previous);
  plugin.update({ docChanged: true, view });
  expect(plugin.decorations.size).toBe(5);
});
