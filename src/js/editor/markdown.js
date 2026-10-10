import { HighlightStyle } from "@codemirror/language";
import { RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, class: "cm-md-token-heading-1" },
  { tag: tags.heading2, class: "cm-md-token-heading-2" },
  { tag: tags.heading3, class: "cm-md-token-heading-3" },
  { tag: tags.heading4, class: "cm-md-token-heading-4" },
  { tag: tags.heading5, class: "cm-md-token-heading-5" },
  { tag: tags.heading6, class: "cm-md-token-heading-5" },
  { tag: tags.strong, class: "cm-md-token-strong" },
  { tag: tags.emphasis, class: "cm-md-token-emphasis" },
  { tag: tags.link, class: "cm-md-token-link" },
  { tag: tags.url, class: "cm-md-token-url" },
  { tag: tags.quote, class: "cm-md-token-quote" },
  { tag: tags.monospace, class: "cm-md-token-code" },
  { tag: tags.contentSeparator, class: "cm-md-token-separator" },
  { tag: tags.processingInstruction, class: "cm-md-token-markup" },
]);

/**
 * Build heading decorations for the visible Markdown document.
 *
 * @param {import('@codemirror/state').Text} document_ - Markdown document to decorate.
 * @returns {import('@codemirror/view').DecorationSet} Line decorations for Markdown headings.
 */
function buildHeadingLineDecorations(document_) {
  const builder = new RangeSetBuilder();

  for (let index = 1; index <= document_.lines; index++) {
    const line = document_.line(index);
    const level = line.text.match(/^(#{1,5})\s/);

    if (!level) {
      continue;
    }

    builder.add(line.from, line.from, Decoration.line({ class: `cm-md-heading-${level[1].length}` }));
  }

  return builder.finish();
}

export const headingLineDecorations = StateField.define({
  create: (s) => buildHeadingLineDecorations(s.doc),
  update: (d, tr) => (tr.docChanged ? buildHeadingLineDecorations(tr.newDoc) : d),
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Decorate Markdown prefixes and complete code fence lines.
 *
 * @param {RangeSetBuilder} builder - Builder collecting ordered Markdown decorations.
 * @param {object} line - Current document line with its text and offsets.
 * @param {object} decorations - Markdown marker and code fence decorations.
 */
function decorateMarkerLine(builder, line, decorations) {
  for (const pattern of [
    /^(#{1,5})(?=\s)/,
    /^(\s*>)(?=\s|$)/,
    /^(\s*[-*+])(?=\s|$)/,
  ]) {
    const match = line.text.match(pattern);

    if (match) {
      builder.add(line.from, line.from + match[1].length, decorations.marker);
    }
  }

  if (line.text.startsWith("```")) {
    builder.add(line.from, line.to, decorations.codeFence);
  }
}

/**
 * Decorate visible lines without scanning the full document.
 *
 * @param {EditorView} view - CodeMirror view supplying visible document ranges.
 * @param {RangeSetBuilder} builder - Builder collecting ordered Markdown decorations.
 * @param {object} range - Visible character range to decorate.
 */
function decorateVisibleRange(view, builder, range) {
  const decorations = {
    marker: Decoration.mark({ class: "cm-md-marker" }),
    codeFence: Decoration.mark({ class: "cm-md-code-fence" }),
  };

  let position = range.from;

  while (position <= range.to) {
    const line = view.state.doc.lineAt(position);
    decorateMarkerLine(builder, line, decorations);
    if (line.to >= range.to) {
      return;
    }

    position = line.to + 1;
  }
}

/**
 * Build decorations for Markdown punctuation in visible ranges.
 *
 * @param {EditorView} view - CodeMirror view supplying visible document ranges.
 * @returns {import('@codemirror/view').DecorationSet} Decorations for visible Markdown markers and code fences.
 */
function buildMarkdownMarkerDecorations(view) {
  const builder = new RangeSetBuilder();

  for (const range of view.visibleRanges) {
    decorateVisibleRange(view, builder, range);
  }

  return builder.finish();
}

export const markdownMarkerDecorations = ViewPlugin.fromClass(
  class {
    /**
     * Create the state needed by this collaborator.
     *
     * @param {EditorView} view - CodeMirror view supplying visible document ranges.
     */
    constructor(view) {
      this.decorations = buildMarkdownMarkerDecorations(view);
    }
    /**
     * Recompute decorations after document or viewport changes.
     *
     * @param {import('@codemirror/view').ViewUpdate} u - Document and viewport change notification.
     */
    update(u) {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = buildMarkdownMarkerDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
