import { Controller } from "@hotwired/stimulus";

import { createEntry } from "../files/create.js";
import { IgnoreFileCache } from "../files/ignore-cache.js";
import { Project } from "../files/project.js";
import { ProjectReader } from "../files/reader.js";
import { OpeningFeedback } from "../ui/opening.js";

/**
 * Report whether native file pickers are available in a secure context.
 *
 * @returns {boolean} Whether both native file pickers exist.
 */
function hasFSAccess() {
  return typeof showDirectoryPicker === "function" && typeof showOpenFilePicker === "function";
}

const ACCESS_TOAST_DURATION = 7000;
const CLEANUP_TOAST_DURATION = 8000;
const OPERATION_PENDING = "Дождитесь завершения текущей операции.";

export default class WorkspaceController extends Controller {
  static outlets = [
    "tree",
    "editor",
    "search",
  ];

  static classes = [
    "fallback",
    "visible",
    "open",
    "toastVisible",
    "saved",
    "saving",
    "error",
  ];

  static targets = [
    "app",
    "banner",
    "unsupported",
    "sidebar",
    "overlay",
    "statusDot",
    "statusText",
    "rootName",
    "mobileTitle",
    "toast",
    "openButton",
    "openMenu",
    "fileInput",
    "directoryInput",
    "resumeButton",
    "placeholder",
    "opening",
    "content",
  ];

  /**
   * Share a text read while preventing stale cache replacement.
   *
   * @param {string} path - Project-relative file or directory path.
   * @param {object} node - Project node being read or modified.
   * @returns {Promise<string>} Current file text from the live draft or shared read.
   */
  async readText(path, node) {
    const liveText = this.editor.textFor(path);

    if (liveText !== undefined) {
      return liveText;
    }

    if (node.text !== undefined) {
      return node.text;
    }

    const result = await this.reader.readNode(node);

    return result.text;
  }
  /**
   * Read searchable text while preserving the active draft.
   *
   * @param {string} path - Project-relative file or directory path.
   * @param {object} node - Project node being read or modified.
   * @returns {Promise<string>} Searchable text, with binary file contents omitted.
   */
  readSearchText(path, node) {
    const liveText = this.editor.textFor(path);

    if (liveText !== undefined) {
      return Promise.resolve(liveText);
    }

    if (node.text !== undefined) {
      return Promise.resolve(node.text);
    }

    return this.reader.readSearchText(node);
  }
  /**
   * Create the state owned by this component.
   */
  initialize() {
    this.project = new Project();
    this.ignoreFiles = new IgnoreFileCache();
    this.reader = new ProjectReader(this.project);
  }

  /**
   * Resolve the tree controller attached to this workspace.
   *
   * @returns {Controller} Tree controller attached to this element.
   */
  get tree() {
    return this.treeOutlet;
  }
  /**
   * Resolve the editor controller attached to this workspace.
   *
   * @returns {Controller} Editor controller attached to this element.
   */
  get editor() {
    return this.editorOutlet;
  }
  /**
   * Resolve the search controller attached to this workspace.
   *
   * @returns {Controller} Search controller attached to this element.
   */
  get search() {
    return this.searchOutlet;
  }

  /**
   * Attach the component to the workspace and register event handlers.
   */
  connect() {
    this.bannerDismissed = false;
    this.openVersion = 0;
    this.opening = new OpeningFeedback(this.openingTarget, this.contentTarget);
    this.toastTimer = null;
    this.apiOk = hasFSAccess() && globalThis.isSecureContext && location.protocol !== "file:";
    if (!this.apiOk) {
      this.enableFallback();
    }

    this._onKey = (event) => {
      if (event.key !== "Escape") {
        return;
      }

      if (this.tree.hasOpenDialog && !this.project.operationBusy) {
        event.preventDefault();
        this.tree.cancelAction();
      }

      this.closeOpenMenu();
      this.tree.closeContextMenu();
      this.closeSidebar();
    };

    this._onClick = (event) => {
      if (!event.target.closest(".sidebar-actions")) {
        this.closeOpenMenu();
      }

      if (!event.target.closest(".context-menu, .tree-actions")) {
        this.tree.closeContextMenu();
      }
    };

    document.addEventListener("click", this._onClick);
    document.addEventListener("keydown", this._onKey);
    this.appTarget.dataset.ready = "true";
    this.loadRecentWorkspace();
  }

  /**
   * Release the component resources and remove event handlers.
   */
  disconnect() {
    this.openVersion++;
    this.opening.clear();
    this.reader.cancel();
    this.project.projectVersion++;
    this.project.currentPath = null;
    this.project.fileHandle = null;
    this.placeholderTarget.hidden = false;
    this.hideToast();
    document.removeEventListener("keydown", this._onKey);
    document.removeEventListener("click", this._onClick);
  }

  /**
   * Explain available file operations when disk writes are unavailable.
   *
   * @param {string|undefined} reason - Reason native disk access is unavailable.
   */
  enableFallback(reason) {
    this.apiOk = false;
    const isInsecure = !globalThis.isSecureContext || location.protocol === "file:";
    const defaultReason = isInsecure ? "insecure" : "unsupported";
    this.renderFallbackHelp(reason || defaultReason);
    if (!this.bannerDismissed) {
      this.appTarget.classList.add(...this.fallbackClasses);
      this.bannerTarget.classList.add(...this.visibleClasses);
    }

    this.placeholderTarget.querySelector("p").textContent =
      "Откройте папку или файл. После редактирования скачайте изменения.";
  }
  /**
   * Describe the current limitation of native disk access.
   *
   * @param {string|undefined} reason - Reason native disk access is unavailable.
   */
  renderFallbackHelp(reason) {
    const messages = {
      unsupported: [
        "Браузер не поддерживает автосохранение",
        "Сохраняйте изменения кнопкой «Скачать». Для записи прямо в папку используйте Chrome или Edge на компьютере.",
      ],
      insecure: [
        "Автосохранение недоступно на этой странице",
        "Сохраняйте изменения кнопкой «Скачать». В Chrome или Edge на компьютере откройте приложение по HTTPS и разрешите доступ к папке.",
      ],
      permission: [
        "Доступ к файлам ограничен",
        "Браузер не разрешил запись в папку. Откройте её заново и разрешите изменение файлов или сохраняйте правки кнопкой «Скачать».",
      ],
    };

    const [
      title,
      description,
    ] = messages[reason];

    const help = this.bannerTarget.querySelector("div");
    help.classList.add("save-help");
    help.replaceChildren();
    const heading = document.createElement("strong");
    heading.className = "save-help-title";
    heading.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.className = "save-help-description";
    paragraph.textContent = description;
    help.append(heading, paragraph);
  }

  /**
   * Dismiss the file access explanation.
   */
  dismissBanner() {
    this.bannerDismissed = true;
    this.bannerTarget.classList.remove(...this.visibleClasses);
    this.appTarget.classList.remove(...this.fallbackClasses);

    const focusTarget = matchMedia("(max-width: 768px)").matches
      ? this.appTarget.querySelector(".mobile-bar button")
      : this.openButtonTarget;

    focusTarget?.focus();
  }

  /**
   * Load files selected through the fallback browser input.
   *
   * @param {Event} event - Browser event triggering this action.
   */
  async importFiles(event) {
    if (this.project.operationBusy) {
      return;
    }

    const input = event.target;

    const files = [
      ...input.files,
    ];

    if (files.length === 0) {
      return;
    }

    try {
      await this.loadUploadedFiles(files, input === this.directoryInputTarget);
      this.closeSidebar();
    } catch (error) {
      this.showToast(this.errMsg(error));
      this.setStatus("Ошибка чтения", "error");
    } finally {
      input.value = "";
    }
  }
  /**
   * Populate the fallback project and open its first standalone file.
   *
   * @param {Array<File>} files - File snapshots selected by the user.
   * @param {boolean} isDirectory - Whether the selected workspace is a folder.
   */
  async loadUploadedFiles(files, isDirectory) {
    this.editor.closeEditor();
    this.project.dirHandle = null;
    this.project.nodes.clear();
    this.tree.reset();
    this.project.workspaceIsDirectory = isDirectory;
    const root = isDirectory ? files[0].webkitRelativePath.split("/", 1)[0] : files[0].name;
    this.setProjectName(root);
    this.project.importFiles(files, isDirectory);
    if (isDirectory) {
      const excluded = await this.project.exclusions(
        () => true,
        (path, node) => this.readText(path, node),
      );

      this.project.excludeNodes(excluded);
    }

    this.project.sortNodes();
    this.prepareTree();
    this.tree.renderTree();
    if (isDirectory) {
      this.setStatus("Папка открыта", "saved");

      return;
    }

    await this.openNode(files[0].name);
  }
  /**
   * Update project labels in the desktop and mobile layouts.
   *
   * @param {string} name - Requested sibling name.
   */
  setProjectName(name) {
    this.rootNameTarget.textContent = name;
    this.mobileTitleTarget.textContent = name;
  }

  /**
   * Toggle the file and folder picker menu.
   */
  toggleOpenMenu() {
    const open = this.openMenuTarget.hidden;
    this.openMenuTarget.hidden = !open;
    this.openButtonTarget.setAttribute("aria-expanded", String(open));
    if (open) {
      this.openMenuTarget.querySelector("button").focus();
    }
  }

  /**
   * Hide the file and folder picker menu.
   */
  closeOpenMenu() {
    this.openMenuTarget.hidden = true;
    this.openButtonTarget.setAttribute("aria-expanded", "false");
  }

  /**
   * Refresh project exclusions without committing stale scans.
   */
  async refreshExclusions() {
    try {
      this.project.invalidateExclusions();
      if (!(await this.refreshProjectNodes())) {
        return;
      }

      this.project.projectVersion++;
      this.reader.prune();
      this.refreshCurrentNode();
      this.tree.refresh();
      this.search.invalidate();
      if (this.search.isOpen) {
        this.search.queueSearch();
      }
    } catch (error) {
      this.showToast(`Не удалось обновить правила .gitignore: ${this.errMsg(error)}`);
      this.setStatus("Ошибка обновления проекта", "error");
    }
  }
  /**
   * Rescan native folders or filter the uploaded project.
   *
   * @returns {Promise<boolean>} Whether a current node refresh was applied.
   */
  async refreshProjectNodes() {
    if (this.project.dirHandle) {
      return this.project.refreshDirectory((path, handle) =>
        this.readText(path, this.project.nodes.get(path) || { handle }),
      );
    }

    const version = this.project.projectVersion;

    const excluded = await this.project.exclusions(
      () => version === this.project.projectVersion,
      (path, node) => this.readText(path, node),
    );

    if (!excluded || version !== this.project.projectVersion) {
      return false;
    }

    this.project.excludeNodes(excluded);

    return true;
  }
  /**
   * Update the active handle or close a newly excluded disk file.
   */
  refreshCurrentNode() {
    if (!this.project.currentPath) {
      return;
    }

    const current = this.project.nodes.get(this.project.currentPath);

    if (current) {
      this.project.fileHandle = current.handle;
      this.editor.refreshFileName();

      return;
    }

    if (this.project.dirHandle) {
      this.editor.closeEditor();
    }
  }

  /**
   * Reset tree and reader state for a newly opened project.
   */
  prepareTree() {
    this.tree.reset();
    this.reader.reset();
    this.project.projectVersion++;
    this.search.invalidate();
  }

  /**
   * Toggle sidebar visibility on small screens.
   */
  toggleSidebar() {
    const isOpen = !this.sidebarTarget.classList.contains(this.openClass);

    for (const element of [
      this.sidebarTarget,
      this.overlayTarget,
    ]) {
      for (const className of this.openClasses) {
        element.classList.toggle(className, isOpen);
      }
    }
  }

  /**
   * Hide the sidebar on small screens.
   */
  closeSidebar() {
    this.sidebarTarget.classList.remove(...this.openClasses);
    this.overlayTarget.classList.remove(...this.openClasses);
  }

  /**
   * Read or write the recent workspace in IndexedDB.
   *
   * @param {object|undefined} value - Recent workspace to store, or undefined to read it.
   * @returns {Promise<object|undefined>} Stored workspace or the result of persisting its replacement.
   */
  async workspaceSetting(value) {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("open-notes", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("settings");
      request.onsuccess = () => resolve(request.result);
      request.addEventListener("error", () => reject(request.error));
    });

    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("settings", value ? "readwrite" : "readonly");
        const store = transaction.objectStore("settings");
        const request = value ? store.put(value, "workspace") : store.get("workspace");
        transaction.oncomplete = () => resolve(request.result);
        transaction.addEventListener("error", () => reject(transaction.error));
        transaction.addEventListener("abort", () => reject(transaction.error));
      });
    } finally {
      database.close();
    }
  }

  /**
   * Restore the most recently selected native workspace.
   */
  async loadRecentWorkspace() {
    if (!this.apiOk) {
      return;
    }

    try {
      this.recentWorkspace = await this.workspaceSetting();
      const handle = this.recentWorkspace?.handle;

      if (!handle || this.project.nodes.size > 0) {
        return;
      }

      this.resumeButtonTarget.textContent = `Продолжить: ${handle.name}`;
      this.resumeButtonTarget.title = handle.name;
      this.resumeButtonTarget.hidden = false;
    } catch {
      /*
      Storage can be disabled; opening files still works.
      */
    }
  }

  /**
   * Remember a native workspace for the next launch.
   */
  rememberWorkspace() {
    const handle = this.project.dirHandle || this.project.fileHandle;

    if (!this.apiOk || !handle || typeof handle.queryPermission !== "function") {
      return;
    }

    const value = { handle, path: this.project.currentPath, ignores: this.ignoreFiles.snapshot() };
    this.recentWorkspace = value;
    void this.persistWorkspace(value);
  }
  /**
   * Save the recent workspace without interrupting editing on storage errors.
   *
   * @param {object|undefined} value - Recent workspace to store, or undefined to read it.
   */
  async persistWorkspace(value) {
    try {
      await this.workspaceSetting(value);
    } catch {
      // Storage may be disabled; the opened project remains usable.
    }
  }

  /**
   * Request access and reopen the remembered workspace.
   */
  async resumeWorkspace() {
    if (this.project.operationBusy || !this.recentWorkspace) {
      return;
    }

    const { handle, path } = this.recentWorkspace;

    try {
      if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") {
        this.showToast("Разрешите доступ к проекту или откройте другую папку.");

        return;
      }

      if (this.editor.hasDocument && !(await this.editor.save())) {
        return;
      }

      await this.loadNativeWorkspace(handle, this.recentWorkspace.ignores);
      await this.restoreSelectedFile(handle, path);
      this.setStatus("Проект открыт", "saved");
      this.closeSidebar();
    } catch {
      this.showToast("Не удалось открыть прошлый проект. Выберите папку заново.");
    }
  }
  /**
   * Load an authorized native file or directory into the shared project.
   *
   * @param {object} handle - Native file system handle.
   * @param {Array|undefined} ignores - Rule snapshots belonging to this remembered workspace.
   */
  async loadNativeWorkspace(handle, ignores) {
    const version = this.opening.begin(`Открываем ${handle.name}…`);

    try {
      await this.readNativeWorkspace(handle, ignores);
    } finally {
      this.opening.finish(version);
    }
  }
  /**
   * Enumerate an authorized workspace before rendering its tree.
   *
   * @param {object} handle - Native file system handle.
   * @param {Array|undefined} ignores - Rule snapshots belonging to this remembered workspace.
   */
  async readNativeWorkspace(handle, ignores) {
    this.ignoreFiles = new IgnoreFileCache(ignores);
    this.editor.closeEditor();
    this.project.nodes.clear();
    this.tree.reset();
    this.project.dirHandle = handle.kind === "directory" ? handle : null;
    this.project.workspaceIsDirectory = Boolean(this.project.dirHandle);
    this.setProjectName(handle.name);
    if (this.project.dirHandle) {
      await this.project.scanDirectory(handle, "", {
        readIgnore: (path, fileHandle) => this.ignoreFiles.read(path, fileHandle),
      });
    }

    if (!this.project.dirHandle) {
      this.project.nodes.set(handle.name, { handle, kind: "file", name: handle.name, parentPath: "" });
    }

    this.prepareTree();
    this.tree.renderTree();
  }
  /**
   * Restore an available recent path or a standalone file.
   *
   * @param {object} handle - Native file system handle.
   * @param {string} path - Project-relative file or directory path.
   */
  async restoreSelectedFile(handle, path) {
    if (path && this.project.nodes.has(path)) {
      await this.openNode(path);

      return;
    }

    if (!this.project.dirHandle) {
      await this.openNode(handle.name);
    }
  }

  /**
   * Request native access and load the selected folder.
   */
  async openDirectory() {
    if (this.project.operationBusy) {
      return;
    }

    this.closeOpenMenu();
    if (!this.apiOk) {
      this.directoryInputTarget.click();

      return;
    }

    try {
      const handle = await showDirectoryPicker({ mode: "readwrite" });

      if (this.editor.hasDocument && !(await this.editor.save())) {
        return;
      }

      await this.loadNativeWorkspace(handle);
      this.editor.closeEditor();
      this.setStatus("Готово", "saved");
      this.rememberWorkspace();
      this.closeSidebar();
    } catch (error) {
      this.reportPickerError(error);
    }
  }
  /**
   * Explain picker failures while keeping cancellation silent.
   *
   * @param {Error|DOMException} error - File operation failure to report.
   */
  reportPickerError(error) {
    if (error.name === "AbortError") {
      return;
    }

    if (
      [
        "SecurityError",
        "NotAllowedError",
      ].includes(error.name)
    ) {
      this.enableFallback("permission");
      this.showToast(
        "Доступ к диску ограничен. Нажмите кнопку ещё раз для обычного выбора.",
        ACCESS_TOAST_DURATION,
      );
      this.setStatus("Обычный выбор файлов", "error");

      return;
    }

    this.showToast(this.errMsg(error));
    this.setStatus("Ошибка", "error");
  }

  /**
   * Request native access and open the selected file.
   */
  async openFile() {
    if (this.project.operationBusy) {
      return;
    }

    this.closeOpenMenu();
    if (!this.apiOk) {
      this.fileInputTarget.click();

      return;
    }

    try {
      const [
        handle,
      ] = await showOpenFilePicker({ multiple: false });

      if (this.editor.hasDocument && !(await this.editor.save())) {
        return;
      }

      await this.loadNativeWorkspace(handle);
      this.project.fileHandle = handle;
      await this.openNode(handle.name);
      this.closeSidebar();
    } catch (error) {
      this.reportPickerError(error);
    }
  }

  /**
   * Convert a file access failure into a readable message.
   *
   * @param {Error|DOMException} error - File operation failure to report.
   * @returns {string} Readable description of the file access failure.
   */
  errMsg(error) {
    if (error.name === "NotAllowedError") {
      return "Нет разрешения на доступ";
    }

    if (error.name === "SecurityError") {
      return "Нужен HTTPS или localhost";
    }

    return error.message || "Ошибка";
  }

  /**
   * Open the node selected by a tree event.
   *
   * @param {Event} event - Browser event triggering this action.
   * @returns {Promise<void>} Completion of opening the selected tree node.
   */
  selectFile(event) {
    return this.openNode(event.detail.path);
  }

  /**
   * Read a selected node and commit the switch after saving its predecessor.
   *
   * @param {string} path - Project-relative file or directory path.
   */
  async openNode(path) {
    const node = this.project.nodes.get(path);

    if (!node || node.kind !== "file" || this.project.operationBusy) {
      return;
    }

    if (this.project.currentPath === path) {
      this.openVersion++;
      this.opening.clear();
      this.closeSidebar();

      return;
    }

    const version = ++this.openVersion;
    const feedback = this.opening.begin(`Открываем ${node.name}…`);

    try {
      await this.readSelectedNode(path, node, version);
    } finally {
      this.opening.finish(feedback);
    }
  }
  /**
   * Commit a selected file only while its read still owns the selection.
   *
   * @param {string} path - Selected project-relative path.
   * @param {object} node - File node captured before reading.
   * @param {number} version - Ownership token for this selection.
   */
  async readSelectedNode(path, node, version) {
    try {
      const result = await this.reader.readNode(node);

      if (!this.isCurrentOpen(path, node, version)) {
        return;
      }

      this.editor.cancelSave();
      if (!(await this.saveBeforeSwitch(path))) {
        return;
      }

      if (this.isCurrentOpen(path, node, version)) {
        this.commitOpenNode(path, node, result);
      }
    } catch (error) {
      if (version === this.openVersion) {
        this.showToast(this.errMsg(error));
        this.setStatus("Ошибка чтения", "error");
      }
    }
  }
  /**
   * Check that a file switch still owns the requested node.
   *
   * @param {string} path - Project-relative file or directory path.
   * @param {object} node - Project node being read or modified.
   * @param {number} version - Search generation captured before asynchronous work.
   * @returns {boolean} Whether this file switch still owns the node.
   */
  isCurrentOpen(path, node, version) {
    if (version !== this.openVersion || this.project.operationBusy) {
      return false;
    }

    return this.project.nodes.get(path) === node;
  }
  /**
   * Persist the previous writable draft before switching files.
   *
   * @param {string} path - Project-relative file or directory path.
   * @returns {Promise<boolean>} Whether switching away from the document is safe.
   */
  async saveBeforeSwitch(path) {
    const handle = this.project.fileHandle;
    const canSave = handle && typeof handle.createWritable === "function";

    if (!canSave || !this.editor.hasDocument || this.project.currentPath === path) {
      return true;
    }

    return await this.editor.save();
  }
  /**
   * Commit a current read and update the editor and tree selection.
   *
   * @param {string} path - Project-relative file or directory path.
   * @param {object} node - Project node being read or modified.
   * @param {object} result - Completed read or file operation result.
   */
  commitOpenNode(path, node, result) {
    this.project.fileHandle = node.handle;
    this.project.currentPath = path;
    this.editor.refreshFileName();
    this.showDocument(result);
    this.tree.selectPath(path);
    this.setStatus(result.type ? "Просмотр" : "Открыт", "saved");
    this.rememberWorkspace();
    this.closeSidebar();
  }
  /**
   * Select the text editor or binary preview for a read result.
   *
   * @param {object} result - Completed read or file operation result.
   */
  showDocument(result) {
    if (result.type) {
      this.editor.showObjectPreview(result.file, result.type);

      return;
    }

    this.editor.showEditor(result.text);
  }

  /**
   * Create a project entry while protecting the active draft and filesystem.
   *
   * @param {object} request - Parent directory, relative path and optional kind.
   * @returns {Promise<object>} Created entry's path and kind.
   */
  async createNode(request) {
    if (this.project.operationBusy || !this.openingTarget.hidden) {
      throw new Error(OPERATION_PENDING);
    }

    if (!this.project.dirHandle && typeof this.project.fileHandle?.createWritable === "function") {
      throw new Error("Для создания на диске откройте содержащую файл папку.");
    }

    this.project.operationBusy = true;
    this.editor.setBusy(true);
    let result;

    try {
      if (!(await this.editor.save())) {
        throw new Error("Не удалось сохранить текущий файл. Создание отменено.");
      }

      result = await createEntry(this.project, request);
      this.commitCreatedNode(result);
    } finally {
      this.finishFileOperation();
    }

    if (result.kind === "file") {
      await this.openNode(result.path);
    }

    return result;
  }

  /**
   * Reveal a committed creation and invalidate project search results.
   *
   * @param {object} result - Created entry's path and kind.
   */
  commitCreatedNode(result) {
    if (!this.project.workspaceIsDirectory) {
      this.project.workspaceIsDirectory = true;
      this.setProjectName("Новый проект");
    }

    if (result.kind === "directory") {
      this.tree.expanded.add(result.path);
    }

    this.refreshAfterOperation();
    this.tree.selectPath(result.path);
    this.tree.focusTreeItem(result.path);
    this.setStatus(this.project.dirHandle ? "Создано на диске" : "Создано в проекте", "saved");
  }

  /**
   * Coordinate disk and tree updates when moving a project node.
   *
   * @param {string} path - Project-relative file or directory path.
   * @param {string} destination - Project-relative destination directory.
   * @param {object} options - Options controlling this file operation.
   */
  async moveNode(path, destination, options = {}) {
    const node = this.project.nodes.get(path);

    if (!this.canMoveNode(path, destination, options) || !node) {
      return;
    }

    const requestedName = options.requestedName;

    if (destination === node.parentPath && (!requestedName || requestedName === node.name)) {
      return;
    }

    const operation = { path, destination, node, requestedName, originalEditor: this.project.currentPath };
    this.project.operationBusy = true;
    this.editor.setBusy(true);
    try {
      await this.performMove(operation);
    } catch (error) {
      if (options.shouldPropagate) {
        throw error;
      }

      this.showToast(this.errMsg(error));
      this.setStatus("Ошибка перемещения", "error");
    } finally {
      this.finishFileOperation();
    }
  }
  /**
   * Reject busy or invalid destinations before starting a move.
   *
   * @param {string} path - Project-relative file or directory path.
   * @param {string} destination - Project-relative destination directory.
   * @param {object} options - Options controlling this file operation.
   * @returns {boolean} Whether the destination and workspace allow a move.
   */
  canMoveNode(path, destination, options) {
    if (this.project.operationBusy) {
      return this.rejectMove(new Error(OPERATION_PENDING), options);
    }

    if (destination === path || destination.startsWith(`${path}/`)) {
      return this.rejectMove(new Error("Нельзя переместить папку внутрь самой себя."), options);
    }

    return !destination || this.project.nodes.get(destination)?.kind === "directory";
  }
  /**
   * Report or propagate a rejected move according to its caller.
   *
   * @param {Error|DOMException} error - File operation failure to report.
   * @param {object} options - Options controlling this file operation.
   * @returns {boolean} False after reporting the rejected move.
   */
  rejectMove(error, options) {
    if (options.shouldPropagate) {
      throw error;
    }

    if (!this.project.operationBusy) {
      this.showToast(error.message);
    }

    return false;
  }
  /**
   * Persist the draft and move a node before updating its navigation state.
   *
   * @param {object} operation - Paths, handles and callbacks captured before the operation.
   */
  async performMove(operation) {
    const { path, destination, node, requestedName } = operation;
    const rulesChanged = this.project.containsIgnoreFile(path) || requestedName === ".gitignore";

    const hasStandaloneWriter =
      this.project.fileHandle && typeof this.project.fileHandle.createWritable === "function";

    if (hasStandaloneWriter && !this.project.dirHandle) {
      throw new Error("Откройте содержащую файл папку для операций на диске.");
    }

    if (this.project.dirHandle && !(await this.editor.save())) {
      throw new Error("Не удалось сохранить изменения перед перемещением.");
    }

    const result = await this.project.move(path, destination, {
      requestedName,
      onCleanupError: (name) =>
        this.showToast(
          `Не удалось завершить операцию. Исходный файл сохранён; проверьте копию «${name}».`,
          CLEANUP_TOAST_DURATION,
        ),
    });

    this.commitMovedNode(operation, result);
    if (result.newName !== (requestedName || node.name)) {
      this.showToast(`Имя уже занято. Новое имя: ${result.newName}`);
    }

    if (rulesChanged) {
      await this.refreshExclusions();
    }
  }
  /**
   * Remap active file handles and navigation after a completed move.
   *
   * @param {object} operation - Paths, handles and callbacks captured before the operation.
   * @param {object} result - Completed read or file operation result.
   */
  commitMovedNode(operation, result) {
    const { path, destination, originalEditor } = operation;
    const { newName, newPath } = result;
    this.tree.remapPaths(path, newPath, destination);
    if (originalEditor === path || originalEditor?.startsWith(`${path}/`)) {
      this.project.currentPath = newPath + originalEditor.slice(path.length);
      this.project.fileHandle = this.project.nodes.get(this.project.currentPath).handle;
      this.editor.refreshFileName();
    }

    if (!this.project.workspaceIsDirectory) {
      this.rootNameTarget.textContent = newName;
    }

    this.refreshAfterOperation();
    this.setStatus(this.project.dirHandle ? "Изменено на диске" : "Изменено в проекте", "saved");
  }
  /**
   * Invalidate search results and render the changed project.
   */
  refreshAfterOperation() {
    this.project.projectVersion++;
    this.search.invalidate();
    this.tree.refresh(true);
  }
  /**
   * Release the operation lock and enable editing.
   */
  finishFileOperation() {
    this.project.operationBusy = false;
    this.editor.setBusy(false);
  }

  /**
   * Coordinate deletion and refresh affected navigation state.
   *
   * @param {string} path - Project-relative file or directory path.
   */
  async removeNode(path) {
    if (this.project.operationBusy) {
      throw new Error(OPERATION_PENDING);
    }

    const node = this.project.nodes.get(path);

    if (!node) {
      return;
    }

    this.project.operationBusy = true;
    this.editor.setBusy(true);
    try {
      if (this.project.dirHandle && !(await this.editor.save())) {
        throw new Error("Не удалось сохранить изменения перед удалением.");
      }

      const rulesChanged = this.project.containsIgnoreFile(path);
      const removed = await this.project.remove(path);
      this.commitRemovedNode(path, node, removed);
      if (rulesChanged) {
        await this.refreshExclusions();
      }
    } finally {
      this.finishFileOperation();
    }
  }
  /**
   * Close an affected document and remove stale tree paths.
   *
   * @param {string} path - Project-relative file or directory path.
   * @param {object} node - Project node being read or modified.
   * @param {Array<string>} removed - Paths removed from the project.
   */
  commitRemovedNode(path, node, removed) {
    if (this.project.currentPath === path || this.project.currentPath?.startsWith(`${path}/`)) {
      this.editor.closeEditor();
    }

    this.tree.removePaths(removed, node.parentPath);
    this.refreshAfterOperation();
    this.setStatus(this.project.dirHandle ? "Удалено с диска" : "Удалено из проекта", "saved");
  }

  /**
   * Update the editor persistence status.
   *
   * @param {string} text - Current file contents.
   * @param {string} kind - File or directory kind.
   */
  setStatus(text, kind) {
    this.statusTextTarget.textContent = text;
    const states = { saved: this.savedClasses, saving: this.savingClasses, error: this.errorClasses };
    this.statusDotTarget.classList.remove(...this.savedClasses, ...this.savingClasses, ...this.errorClasses);
    this.statusDotTarget.classList.add(...(states[kind] || []));
  }

  /**
   * Hide the current temporary notification.
   */
  hideToast() {
    clearTimeout(this.toastTimer);
    const toast = this.toastTarget;
    toast.hidden = true;
    toast.classList.remove(...this.toastVisibleClasses);
    toast.textContent = "";
  }

  /**
   * Show a temporary notification with the requested lifetime.
   *
   * @param {unknown} message - Notification text displayed to the user.
   * @param {number} ms - Notification lifetime in milliseconds.
   */
  showToast(message, ms = 4000) {
    this.hideToast();
    const text = String(message ?? "").trim();

    if (!text) {
      return;
    }

    const toast = this.toastTarget;
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.add(...this.toastVisibleClasses);
    this.toastTimer = setTimeout(() => this.hideToast(), ms);
  }
}
