import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { expect, it } from "vitest";

import { fileLanguage, isMarkdown } from "../../src/js/editor/language.js";

it.each([
  ["app.jsx", "const view = <h1>Hello</h1>;"],
  ["config.JSON", '{"enabled": true, "count": 42}'],
  ["document.XML", '<note id="1"><title>Hello</title></note>'],
  ["module.mts", "export const value: number = 1;"],
  ["module.cts", "export const value: number = 1;"],
  ["app.ts", "const value: number = 1;"],
  ["app.tsx", "const view = <h1>Hello</h1>;"],
  ["app.mjs", "export const value = 1;"],
  ["app.cjs", "module.exports = 1;"],
  ["index.htm", "<h1>Hello</h1>"],
])("parses %s", (path, document_) => {
  const state = EditorState.create({ doc: document_, extensions: fileLanguage(path) });
  expect(syntaxTree(state)).toHaveLength(document_.length);
  expect(syntaxTree(state).topNode.firstChild).not.toBeNull();
  const errors = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.type.isError) {
        errors.push(node.from);
      }
    },
  });
  expect(errors).toEqual([]);
});

it.each(["README.md", "notes.MARKDOWN", "Notes/entry.mdx"])("recognizes %s as Markdown", (path) => {
  expect(isMarkdown(path)).toBe(true);
});

it.each(["README", ".gitignore", "unknown.xyz", "readme.md.js"])("leaves %s outside Markdown", (path) => {
  expect(isMarkdown(path)).toBe(false);
});
