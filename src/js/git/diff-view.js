import { MergeView, goToNextChunk, goToPreviousChunk, unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";

import { fileLanguage } from "../editor/language.js";

/**
 * Show aligned, immutable file versions using the editor's existing CodeMirror engine.
 */
export class DiffView {
  view;
  merge;
  /**
   * Create the selected comparison layout with accessible version names.
   *
   * @param {HTMLElement} parent - Comparison viewport.
   * @param {object} data - Literal path and before/after contents.
   * @param {boolean} isUnified - Whether to combine versions into one column.
   */
  constructor(parent, data, isUnified) {
    const extensions = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      lineNumbers(),
      fileLanguage(data.path),
      keymap.of([
        { key: "F7", run: goToNextChunk },
        { key: "Shift-F7", run: goToPreviousChunk },
      ]),
    ];

    if (isUnified) {
      this.createUnified(parent, data, extensions);

      return;
    }

    this.createSplit(parent, data, extensions);
  }
  /**
   * Mount one inline read-only comparison with deleted lines included.
   *
   * @param {HTMLElement} parent - Comparison viewport.
   * @param {object} data - Before and after file text.
   * @param {Array} extensions - Shared read-only editor configuration.
   */
  createUnified(parent, data, extensions) {
    this.view = new EditorView({
      parent,
      doc: data.after,
      extensions: [
        ...extensions,
        unifiedMergeView({
          original: data.before,
          mergeControls: false,
          syntaxHighlightDeletions: true,
          diffConfig: { timeout: 500 },
        }),
      ],
    });
  }
  /**
   * Mount two aligned file versions with linked vertical scrolling.
   *
   * @param {HTMLElement} parent - Comparison viewport.
   * @param {object} data - Before and after file text.
   * @param {Array} extensions - Shared read-only editor configuration.
   */
  createSplit(parent, data, extensions) {
    this.merge = new MergeView({
      parent,
      a: {
        doc: data.before,
        extensions: [
          ...extensions,
          EditorView.contentAttributes.of({ "aria-label": "Было" }),
        ],
      },
      b: {
        doc: data.after,
        extensions: [
          ...extensions,
          EditorView.contentAttributes.of({ "aria-label": "Стало" }),
        ],
      },
      gutter: true,
      diffConfig: { timeout: 500 },
      collapseUnchanged: { margin: 4, minSize: 12 },
    });
    this.view = this.merge.b;
  }
  /**
   * Navigate changed blocks using the same commands as the keyboard shortcuts.
   *
   * @param {boolean} isPrevious - Whether to move backward.
   */
  navigate(isPrevious) {
    const command = isPrevious ? goToPreviousChunk : goToNextChunk;
    command(this.view);
    this.view.focus();
  }
  /**
   * Release CodeMirror views when closing or switching comparisons.
   */
  destroy() {
    if (this.merge) {
      this.merge.destroy();

      return;
    }

    this.view.destroy();
  }
}
