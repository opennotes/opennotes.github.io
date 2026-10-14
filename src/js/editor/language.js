import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { headingLineDecorations, markdownHighlightStyle, markdownMarkerDecorations } from "./markdown.js";

const languages = new Map([
  [
    "json",
    json,
  ],
  [
    "xml",
    xml,
  ],
  [
    "php",
    php,
  ],
  [
    "css",
    css,
  ],
  [
    "js",
    javascript,
  ],
  [
    "mjs",
    javascript,
  ],
  [
    "cjs",
    javascript,
  ],
  [
    "jsx",
    () => javascript({ jsx: true }),
  ],
  [
    "ts",
    () => javascript({ typescript: true }),
  ],
  [
    "mts",
    () => javascript({ typescript: true }),
  ],
  [
    "cts",
    () => javascript({ typescript: true }),
  ],
  [
    "tsx",
    () => javascript({ typescript: true, jsx: true }),
  ],
  [
    "html",
    html,
  ],
  [
    "htm",
    html,
  ],
  [
    "sql",
    sql,
  ],
]);

const codeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--code-fence)" },
  {
    tag: [
      tags.string,
      tags.regexp,
    ],
    color: "light-dark(#287a3d, #80d99a)",
  },
  {
    tag: [
      tags.number,
      tags.bool,
      tags.null,
    ],
    color: "light-dark(#955400, #e5b56e)",
  },
  { tag: tags.comment, color: "var(--label-secondary)", fontStyle: "italic" },
  {
    tag: [
      tags.tagName,
      tags.typeName,
    ],
    color: "light-dark(#a52a2a, #ff9b91)",
  },
  {
    tag: [
      tags.attributeName,
      tags.propertyName,
    ],
    color: "light-dark(#8256a8, #c6a0e5)",
  },
  { tag: tags.variableName, color: "var(--label)" },
  { tag: tags.definition(tags.variableName), color: "light-dark(#0069b5, #80beff)" },
  { tag: tags.operator, color: "var(--label-secondary)" },
  { tag: tags.invalid, textDecoration: "underline wavy var(--red)" },
]);

/**
 * Identify files that support Markdown formatting commands.
 *
 * @param {string} path - Current file name or project-relative path.
 * @returns {boolean} Whether the file has a Markdown extension.
 */
export function isMarkdown(path) {
  return /\.(md|markdown|mdx)$/i.test(path);
}

/**
 * Configure syntax and document decorations for the current file.
 *
 * @param {string} path - Current file name or project-relative path.
 * @returns {import('@codemirror/state').Extension} Language-specific editor extensions.
 */
export function fileLanguage(path) {
  if (isMarkdown(path)) {
    return [
      markdown(),
      syntaxHighlighting(markdownHighlightStyle),
      headingLineDecorations,
      markdownMarkerDecorations,
      EditorView.lineWrapping,
    ];
  }

  const extension = path.split(".").pop().toLowerCase();
  const language = languages.get(extension);

  return [
    language
      ? [
          language(),
          syntaxHighlighting(codeHighlightStyle),
        ]
      : [],
  ];
}
