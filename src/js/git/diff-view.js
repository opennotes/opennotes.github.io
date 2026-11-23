import { MergeView, getChunks, goToNextChunk, goToPreviousChunk, unifiedMergeView } from "@codemirror/merge";
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
   * @param {object} options - Layout, line wrapping and selection callback.
   */
  constructor(parent, data, options) {
    const extensions = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      lineNumbers(),
      fileLanguage(data.path, true),
      options.hasWrapping ? EditorView.lineWrapping : [],
      EditorState.phrases.of({ "$ unchanged lines": "$ неизменённых строк" }),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet) {
          options.onSelection?.();
        }
      }),
      keymap.of([
        { key: "F7", run: goToNextChunk },
        { key: "Shift-F7", run: goToPreviousChunk },
      ]),
    ];

    if (options.isUnified) {
      this.createUnified(parent, data, extensions);

      this.revealFirst();

      return;
    }

    this.createSplit(parent, data, extensions);
    this.revealFirst();
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
   * Describe the currently selected changed block for the compact navigation toolbar.
   *
   * @returns {object} One-based position and total changed blocks.
   */
  get position() {
    const chunks = getChunks(this.view.state).chunks;
    const following = chunks.findIndex((chunk) => chunk.fromB > this.view.state.selection.main.head);
    const current = following === -1 ? chunks.length : Math.max(1, following);

    return {
      current,
      total: chunks.length,
    };
  }
  /**
   * Start reading at the first change instead of the top of an unrelated document.
   */
  revealFirst() {
    const first = getChunks(this.view.state).chunks[0];

    if (!first) {
      return;
    }

    const anchor = Math.min(first.fromB, this.view.state.doc.length);
    this.view.dispatch({
      selection: { anchor },
      effects: EditorView.scrollIntoView(anchor, { y: "center" }),
    });
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
   * Capture reading position before refreshing a working comparison.
   *
   * @returns {object} Selection and scroll offsets in the current layout.
   */
  snapshot() {
    const scroll = this.merge?.dom || this.view.scrollDOM;

    return {
      anchor: this.view.state.selection.main.anchor,
      top: scroll.scrollTop,
      left: this.view.scrollDOM.scrollLeft,
    };
  }
  /**
   * Restore a reading position after receiving updated working text.
   *
   * @param {object} position - Previously captured reading position.
   */
  restore(position) {
    this.view.dispatch({ selection: { anchor: Math.min(position.anchor, this.view.state.doc.length) } });
    this.view.requestMeasure({
      read: () => null,
      write: () => {
        const scroll = this.merge?.dom || this.view.scrollDOM;
        scroll.scrollTop = position.top;
        this.view.scrollDOM.scrollLeft = position.left;
      },
    });
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
