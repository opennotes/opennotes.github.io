import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { expect, it } from "vitest";

import { fileLanguage, isMarkdown } from "../../src/js/editor/language.js";

it.each([
  ["app.jsx", "const view = <h1>Hello</h1>;"],
  ["app.ts", "const value: number = 1;"],
  ["app.tsx", "const view = <h1>Hello</h1>;"],
  ["app.mjs", "export const value = 1;"],
  ["app.cjs", "module.exports = 1;"],
  ["index.htm", "<h1>Hello</h1>"],
])("parses %s", (path, document_) => {
  const state = EditorState.create({ doc: document_, extensions: fileLanguage(path) });
  expect(syntaxTree(state)).toHaveLength(document_.length);
  expect(syntaxTree(state).topNode.firstChild).not.toBeNull();
});

it.each(["README.md", "notes.MARKDOWN", "Notes/entry.mdx"])("recognizes %s as Markdown", (path) => {
  expect(isMarkdown(path)).toBe(true);
});

it.each(["README", ".gitignore", "unknown.xyz", "readme.md.js"])("leaves %s outside Markdown", (path) => {
  expect(isMarkdown(path)).toBe(false);
});
