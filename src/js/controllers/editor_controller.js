import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { Compartment, EditorState, Text } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  keymap,
  highlightActiveLine,
  drawSelection,
  placeholder as editorPlaceholder,
} from "@codemirror/view";

import { fileLanguage, isMarkdown } from "../editor/language.js";
import { loadLineNumbers, storeLineNumbers } from "../editor/preferences.js";
import { saveSession } from "../editor/session.js";
import { ICO } from "../ui/icons.js";

import WorkspaceComponent from "./workspace_component.js";

const DOWNLOAD_URL_LIFETIME = 1000;
const AUTOSAVE_DELAY = 600;

export default class EditorController extends WorkspaceComponent {
  static classes = [
    "preview",
  ];

  static targets = [
    "editor",
    "placeholder",
    "toolbar",
    "pathLabel",
    "download",
    "lineNumbers",
  ];
  /**
   * Create the state owned by this component.
   */
  initialize() {
    this.view = null;
    this.language = new Compartment();
    this.gutter = new Compartment();
    this.hasLineNumbers = loadLineNumbers();
    this.previewFile = null;
    this.previewUrl = null;
    this.saveTimer = null;
    this.editorSession = null;
    this.refreshPromise = null;
  }
  /**
   * Release the component resources and remove event handlers.
   */
  disconnect() {
    this.resetPreview();
    this.view?.destroy();
    this.view = null;
    this.editorSession = null;
    this.refreshPromise = null;
    this.editorTarget.hidden = true;
    this.toolbarTarget.hidden = true;
    this.pathLabelTarget.textContent = "";
    clearTimeout(this.saveTimer);
  }
  /**
   * Report whether an editable document is mounted.
   *
   * @returns {boolean} Whether a CodeMirror document is mounted.
   */
  get hasDocument() {
    return this.view !== null;
  }
  /**
   * Read the live draft only when the requested path is active.
   *
   * @param {string} path - Project-relative file or directory path.
   * @returns {string|undefined} Live draft contents, or undefined for another path.
   */
  textFor(path) {
    if (path === this.project.currentPath && this.view) {
      return this.view.state.doc.toString();
    }
  }
  /**
   * Check that an active native document has no unsaved edits or pending writes.
   *
   * @returns {boolean} Whether refreshing from disk is currently safe.
   */
  get canRefreshFromDisk() {
    if (
      document.visibilityState !== "visible" ||
      this.project.operationBusy ||
      !this.workspace.openingTarget.hidden
    ) {
      return false;
    }

    const session = this.editorSession;

    if (!this.view || !session || session.promise) {
      return false;
    }

    return (
      typeof session.handle?.createWritable === "function" && this.view.state.sliceDoc() === session.savedText
    );
  }

  /**
   * Refresh a clean document on tab activation without replacing a newer draft.
   */
  async refreshFromDisk() {
    if (!this.canRefreshFromDisk || this.refreshPromise) {
      return;
    }

    const session = this.editorSession;

    const snapshot = {
      session,
      handle: session.handle,
      doc: this.view.state.doc,
      version: this.workspace.openVersion,
    };

    const request = this.readDiskText(snapshot.handle);
    this.refreshPromise = request;
    try {
      const text = await request;

      if (!this.isCurrentDiskRead(snapshot) || text === session.diskText) {
        return;
      }

      this.reloadDiskText(text);
    } catch (error) {
      if (this.editorSession === session && this.canRefreshFromDisk) {
        this.workspace.showToast(`Не удалось обновить файл: ${this.workspace.errMsg(error)}`);
      }
    } finally {
      if (this.refreshPromise === request) {
        this.refreshPromise = null;
      }
    }
  }

  /**
   * Check ownership again after an asynchronous disk read.
   *
   * @param {object} snapshot - Session, handle, document and open version captured before reading.
   * @returns {boolean} Whether the original clean document still owns this read.
   */
  isCurrentDiskRead(snapshot) {
    const ownsSession = this.editorSession === snapshot.session && this.canRefreshFromDisk;

    if (!ownsSession) {
      return false;
    }

    const isSameDocument =
      this.view.state.doc === snapshot.doc && snapshot.session.handle === snapshot.handle;

    return isSameDocument && this.workspace.openVersion === snapshot.version;
  }

  /**
   * Read fresh contents without consulting search or preview caches.
   *
   * @param {object} handle - Native handle of the active document.
   * @returns {Promise<string>} Current text stored on disk.
   */
  async readDiskText(handle) {
    const file = await handle.getFile();

    return file.text();
  }

  /**
   * Replace the clean document while preserving selection, scroll and focus.
   *
   * @param {string} text - Fresh contents read from disk.
   */
  reloadDiskText(text) {
    const state = this.createEditorState(text);
    const { anchor, head } = this.view.state.selection.main;
    const { scrollTop, scrollLeft } = this.view.scrollDOM;
    this.cancelSave();
    this.editorSession = { ...this.editorSession, savedText: state.sliceDoc(), diskText: text };
    this.mountEditor(
      state.update({
        selection: {
          anchor: Math.min(anchor, state.doc.length),
          head: Math.min(head, state.doc.length),
        },
      }).state,
    );
    this.view.scrollDOM.scrollTop = scrollTop;
    this.view.scrollDOM.scrollLeft = scrollLeft;
    this.project.projectVersion++;
    this.fileChanged(this.editorSession);
    if (this.workspace.search.isOpen) {
      this.workspace.search.queueSearch();
    }

    this.workspace.setStatus("Обновлено с диска", "saved");
  }

  /**
   * Invalidate caches and project rules after file contents change.
   *
   * @param {object} session - Session whose file contents changed.
   */
  fileChanged(session) {
    const node = this.project.nodes.get(this.project.currentPath);

    if (node?.handle !== session.handle) {
      return;
    }

    node.searchCache = null;
    if (node.name !== ".gitignore") {
      return;
    }

    this.project.invalidateExclusions();
    this.dispatch("rules-changed");
  }

  /**
   * Cancel the pending autosave timer.
   */
  cancelSave() {
    clearTimeout(this.saveTimer);
  }
  /**
   * Suspend editing while a file operation is in progress.
   *
   * @param {boolean} busy - Whether editing must be suspended.
   */
  setBusy(busy) {
    this.editorTarget.inert = busy;
    this.toolbarTarget.inert = busy;
    if (busy) {
      this.cancelSave();
    }
  }
  /**
   * Select and reveal a search match in the editor.
   *
   * @param {number} offset - Character offset of the search match.
   */
  revealMatch(offset) {
    if (!this.view || offset < 0) {
      return;
    }

    const from = Math.min(offset, this.view.state.doc.length);
    this.view.dispatch({
      selection: { anchor: from },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    this.view.focus();
  }
  /**
   * Refresh file labels and the handle used by the active session.
   */
  refreshFileName() {
    const path = this.project.currentPath;
    const node = this.project.nodes.get(path);
    this.pathLabelTarget.textContent = path;
    if (this.editorSession) {
      this.editorSession.handle = this.project.fileHandle;
    }

    this.workspace.mobileTitleTarget.textContent = node.name;
    if (this.view) {
      this.view.dispatch({ effects: this.language.reconfigure(fileLanguage(path)) });
      this.updateFormatting();
    }

    if (!this.previewFile) {
      return;
    }

    {
      const object = this.editorTarget.querySelector("object");
      object?.setAttribute("aria-label", `Просмотр: ${node.name}`);
      const link = object?.querySelector("a");

      if (link) {
        link.download = node.name;
      }

      const name = object?.querySelector(".object-fallback-name");

      if (name) {
        name.textContent = node.name;
      }
    }
  }

  /**
   * Download the active draft or previewed file.
   */
  downloadFile() {
    if ((!this.view && !this.previewFile) || !this.project.fileHandle) {
      return;
    }

    const blob =
      this.previewFile ||
      new Blob(
        [
          this.view.state.sliceDoc(),
        ],
        {
          type: isMarkdown(this.project.currentPath)
            ? "text/markdown;charset=utf-8"
            : "text/plain;charset=utf-8",
        },
      );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = this.project.nodes.get(this.project.currentPath)?.name || this.project.fileHandle.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME);
    this.workspace.setStatus("Скачивание начато", "saved");
  }

  /**
   * Release the object URL used by the previous preview.
   */
  resetPreview() {
    this.editorTarget.querySelector("object")?.remove();
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
    }

    this.previewUrl = null;
    this.previewFile = null;
  }

  /**
   * Display a binary file using the browser object viewer.
   *
   * @param {File} file - File snapshot used for this operation.
   * @param {string} type - Browser preview MIME type.
   */
  showObjectPreview(file, type) {
    this.editorSession = null;
    this.view?.destroy();
    this.view = null;
    this.resetPreview();
    this.previewFile = file;

    const blob =
      file.type === type
        ? file
        : new Blob(
            [
              file,
            ],
            { type },
          );

    this.previewUrl = URL.createObjectURL(blob);
    this.workspace.placeholderTarget.hidden = true;
    this.editorTarget.hidden = false;
    this.toolbarTarget.hidden = false;
    this.toolbarTarget.classList.add(...this.previewClasses);
    this.downloadTarget.hidden = false;
    this.editorTarget.replaceChildren(this.createPreviewObject(type));
  }
  /**
   * Create an object viewer with an accessible fallback.
   *
   * @param {string} type - Browser preview MIME type.
   * @returns {HTMLObjectElement} Browser object viewer including download fallback.
   */
  createPreviewObject(type) {
    const object = document.createElement("object");
    object.className = "file-object";
    object.type = type;
    object.data = this.previewUrl;
    const name = this.project.nodes.get(this.project.currentPath).name;
    object.setAttribute("aria-label", `Просмотр: ${name}`);
    const fallback = document.createElement("div");
    fallback.className = "object-fallback";
    fallback.append(this.createPreviewFallback(name));
    object.append(fallback);

    return object;
  }
  /**
   * Offer a download when the browser cannot preview a file.
   *
   * @param {string} name - Requested sibling name.
   * @returns {HTMLElement} Download fallback for an unsupported preview format.
   */
  createPreviewFallback(name) {
    const content = this.previewElement("div", "object-fallback-content", "");
    const icon = this.previewElement("span", "object-fallback-icon", "");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = ICO.file;
    const heading = this.previewElement("h2", "", "Нет предпросмотра");
    const filename = this.previewElement("p", "object-fallback-name", name);

    const message = this.previewElement(
      "p",
      "object-fallback-description",
      "Скачайте файл, чтобы открыть его в другом приложении.",
    );

    const link = this.previewElement("a", "btn btn-plain", "Скачать файл");
    link.href = this.previewUrl;
    link.download = name;
    content.append(icon, heading, filename, message, link);

    return content;
  }
  /**
   * Create a preview element with a class and plain text.
   *
   * @param {string} tag - HTML element tag for the preview.
   * @param {string} className - CSS classes applied to the preview element.
   * @param {string} text - Current file contents.
   * @returns {HTMLElement} Element carrying the requested class and plain text.
   */
  previewElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;

    return element;
  }

  /**
   * Mount CodeMirror with the selected document.
   *
   * @param {string} text - Current file contents.
   */
  showEditor(text) {
    this.refreshPromise = null;
    const state = this.createEditorState(text);
    this.editorSession = {
      handle: this.project.fileHandle,
      savedText: state.sliceDoc(),
      diskText: text,
      promise: null,
    };
    this.resetPreview();
    this.toolbarTarget.classList.remove(...this.previewClasses);
    this.workspace.placeholderTarget.hidden = true;
    this.editorTarget.hidden = false;
    this.toolbarTarget.hidden = false;
    this.downloadTarget.hidden = typeof this.project.fileHandle?.createWritable === "function";
    this.mountEditor(state);
    this.updateFormatting();
    this.lineNumbersTarget.setAttribute("aria-pressed", String(this.hasLineNumbers));
    this.view.focus();
  }
  /**
   * Toggle line numbers without changing the draft, selection or history.
   */
  toggleLineNumbers() {
    if (!this.view) {
      return;
    }

    this.hasLineNumbers = !this.hasLineNumbers;
    this.view.dispatch({ effects: this.gutter.reconfigure(this.hasLineNumbers ? lineNumbers() : []) });
    this.lineNumbersTarget.setAttribute("aria-pressed", String(this.hasLineNumbers));
    storeLineNumbers(this.hasLineNumbers);
  }
  /**
   * Enable formatting controls only for Markdown documents.
   */
  updateFormatting() {
    const isDisabled = !isMarkdown(this.project.currentPath || this.project.fileHandle?.name || "");

    for (const button of this.toolbarTarget.querySelectorAll(".toolbar-group .tool-btn")) {
      button.disabled = isDisabled;
    }
  }
  /**
   * Reuse an existing CodeMirror view or mount a new one.
   *
   * @param {EditorState} state - CodeMirror state to mount.
   */
  mountEditor(state) {
    if (this.view) {
      this.view.setState(state);

      return;
    }

    this.editorTarget.replaceChildren();
    this.view = new EditorView({ parent: this.editorTarget, state });
  }
  /**
   * Configure file syntax, editing history and change notifications.
   *
   * @param {string} text - Current file contents.
   * @returns {EditorState} Configured editing state.
   */
  createEditorState(text) {
    return EditorState.create({
      doc: Text.of(text.split(/\r\n?|\n/)),
      extensions: [
        EditorState.lineSeparator.of(text.match(/\r\n?|\n/)?.[0] || "\n"),
        this.gutter.of(this.hasLineNumbers ? lineNumbers() : []),
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        this.language.of(fileLanguage(this.project.currentPath || this.project.fileHandle?.name || "")),
        editorPlaceholder("Начните писать…"),
        keymap.of([
          indentWithTab,
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.scheduleSave();
          }
        }),
      ],
    });
  }

  /**
   * Release the current document and restore the empty state.
   */
  closeEditor() {
    this.editorSession = null;
    this.refreshPromise = null;
    this.workspace.openVersion++;
    this.resetPreview();
    clearTimeout(this.saveTimer);
    this.view?.destroy();
    this.view = null;
    this.project.fileHandle = null;
    this.project.currentPath = null;
    this.editorTarget.hidden = true;
    this.toolbarTarget.hidden = true;
    this.workspace.placeholderTarget.hidden = false;
    this.pathLabelTarget.textContent = "";
    this.editorTarget.replaceChildren();
    this.workspace.mobileTitleTarget.textContent =
      this.workspace.rootNameTarget.textContent === "—"
        ? "Open Notes"
        : this.workspace.rootNameTarget.textContent;
  }

  /**
   * Schedule persistence of the current draft and invalidate search results.
   */
  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.project.projectVersion++;
    if (this.workspace.search.isOpen) {
      this.workspace.search.queueSearch();
    }

    if (typeof this.project.fileHandle?.createWritable !== "function") {
      const node = this.project.nodes.get(this.project.currentPath);

      if (node) {
        node.text = this.view.state.sliceDoc();
        if (node.name === ".gitignore") {
          this.project.invalidateExclusions();
          this.dispatch("rules-changed");
        }
      }

      this.workspace.setStatus("Нужно скачать", "saving");

      return;
    }

    if (!this.editorSession?.promise && this.view.state.sliceDoc() === this.editorSession?.savedText) {
      this.workspace.setStatus("Открыт", "saved");

      return;
    }

    this.workspace.setStatus("Изменения…", "saving");
    this.saveTimer = setTimeout(() => this.save(), AUTOSAVE_DELAY);
  }

  /**
   * Persist the current session and update its status.
   *
   * @returns {Promise<boolean>} Whether the active document is persisted or requires no disk write.
   */
  async save() {
    const session = this.editorSession;

    if (!session || !this.view || typeof session.handle?.createWritable !== "function") {
      return true;
    }

    if (this.view.state.sliceDoc() === session.savedText && !session.promise) {
      return true;
    }

    return await saveSession(session, {
      isCurrent: () => this.editorSession === session,
      readText: () => (this.view ? this.view.state.sliceDoc() : null),
      onSaving: () => this.workspace.setStatus("Сохранение…", "saving"),
      onWritten: () => this.fileChanged(session),
      onComplete: () => this.workspace.setStatus("Сохранено", "saved"),
      onError: (error) => {
        this.downloadTarget.hidden = false;
        this.workspace.showToast(this.workspace.errMsg(error));
        this.workspace.setStatus("Ошибка сохранения", "error");
      },
    });
  }

  /**
   * Toggle a first-level Markdown heading.
   */
  headingOne() {
    this.#togglePrefix("# ");
  }

  /**
   * Toggle a second-level Markdown heading.
   */
  headingTwo() {
    this.#togglePrefix("## ");
  }

  /**
   * Toggle a third-level Markdown heading.
   */
  headingThree() {
    this.#togglePrefix("### ");
  }

  /**
   * Wrap the selection in bold Markdown markers.
   */
  bold() {
    this.#wrap("**", "**", "жирный");
  }

  /**
   * Wrap the selection in italic Markdown markers.
   */
  italic() {
    this.#wrap("*", "*", "курсив");
  }

  /**
   * Insert a Markdown link around the selection.
   */
  link() {
    this.#wrap("[", "](https://)", "текст");
  }

  /**
   * Toggle the Markdown quote prefix.
   */
  quote() {
    this.#togglePrefix("> ");
  }

  /**
   * Wrap the selection in Markdown code markers.
   */
  code() {
    this.#wrap("```\n", "\n```", "");
  }

  /**
   * Toggle the unordered list prefix.
   */
  list() {
    this.#togglePrefix("- ");
  }

  /**
   * Toggle the ordered list prefix.
   */
  orderedList() {
    this.#togglePrefix("1. ");
  }

  /**
   * Preserve the editor selection when toolbar controls receive pointer input.
   *
   * @param {Event} event - Browser event triggering this action.
   */
  keepEditorSelection(event) {
    if (event.button === 0 && event.target.closest(".tool-btn")) {
      event.preventDefault();
    }
  }

  /**
   * Toggle a line prefix across the selected text.
   *
   * @param {string} prefix - Markdown marker or relative path prefix.
   */
  #togglePrefix(prefix) {
    if (
      !this.view ||
      this.project.operationBusy ||
      !isMarkdown(this.project.currentPath || this.project.fileHandle?.name || "")
    ) {
      return;
    }

    const { state } = this.view;
    const selection = state.selection.main;
    const changes = [];
    const first = state.doc.lineAt(selection.from);
    const last = state.doc.lineAt(selection.to);

    for (let number = first.number; number <= last.number; number++) {
      const line = state.doc.line(number);
      changes.push(
        line.text.startsWith(prefix)
          ? { from: line.from, to: line.from + prefix.length, insert: "" }
          : { from: line.from, insert: prefix },
      );
    }

    const changeSet = state.changes(changes);
    this.view.dispatch({
      changes: changeSet,
      selection: { anchor: changeSet.mapPos(selection.to, 1) },
      scrollIntoView: true,
      userEvent: "input.format",
    });
    this.view.focus();
  }

  /**
   * Wrap selected text in the supplied Markdown markers.
   *
   * @param {string} before - Opening Markdown marker.
   * @param {string} after - Closing Markdown marker.
   * @param {string} placeholder - Replacement text when the selection is empty.
   */
  #wrap(before, after, placeholder) {
    if (
      !this.view ||
      this.project.operationBusy ||
      !isMarkdown(this.project.currentPath || this.project.fileHandle?.name || "")
    ) {
      return;
    }

    const selection = this.view.state.selection.main;
    const selected = this.view.state.sliceDoc(selection.from, selection.to);
    const content = selected || placeholder;
    const insert = before + content + after;
    this.view.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: { anchor: selection.from + insert.length },
      scrollIntoView: true,
      userEvent: "input.format",
    });
    this.view.focus();
  }
}
