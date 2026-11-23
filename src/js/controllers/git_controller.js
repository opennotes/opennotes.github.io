import { gitBranch, gitDirectories } from "../git/metadata.js";
import { fileRow, navigateRows, selectRow } from "../git/navigation.js";
import { GitReader } from "../git.js";

import WorkspaceComponent from "./workspace_component.js";

const CHANGE_GROUPS = [
  [
    "staged",
    "В индексе · staged",
    "staged",
  ],
  [
    "working",
    "В рабочей папке · unstaged",
    "working",
  ],
  [
    "untracked",
    "Новые файлы",
    "staged",
  ],
];

const SHORT_OID_LENGTH = 8;
const MOBILE_WIDTH = 768;
const CURRENT_ATTRIBUTE = "aria-current";
const CURRENT_ROW = '[aria-current="true"]';

/**
 * Create a text-only node for repository data, never interpreting file contents.
 *
 * @param {string} tag - HTML element name controlled by this module.
 * @param {string} text - Repository text to display literally.
 * @returns {HTMLElement} Safe node ready to append.
 */
function textNode(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;

  return node;
}

export default class GitController extends WorkspaceComponent {
  static targets = [
    "dialog",
    "mainFolder",
    "repository",
    "launch",
    "controls",
    "status",
    "changes",
    "commits",
    "more",
    "patch",
    "heading",
    "content",
    "fileHistoryTitle",
    "changeSection",
    "commitFiles",
    "commitFileList",
    "historySection",
    "changesTab",
    "historyTab",
    "branch",
    "beforeLabel",
    "afterLabel",
    "counter",
    "previous",
    "next",
    "wrapping",
    "diffControls",
    "layout",
    "versions",
    "workingVersion",
  ];

  /**
   * Keep canceled requests obsolete after reconnecting or changing folders.
   */
  initialize() {
    this.version = 0;
    this.reader = null;
    this.main = undefined;
    this.filePath = null;
    this.diffView = null;
    this.isUnified = window.innerWidth <= MOBILE_WIDTH;
    this.hasLayoutPreference = false;
    this.DiffView = null;
    this.mode = "changes";
    this.hasWrapping = true;
  }
  /**
   * Remove obsolete helper credentials left by the previous version.
   */
  connect() {
    try {
      sessionStorage.removeItem("open-notes-git");
    } catch {
      // Git does not require tab storage.
    }

    const url = new URL(location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));

    if (!fragment.has("git")) {
      return;
    }

    fragment.delete("git");
    url.hash = fragment.toString();
    history.replaceState(null, "", url);
  }
  /**
   * Cancel outstanding reads and release repository objects.
   */
  disconnect() {
    this.version++;
    this.reader?.stop();
    this.reader = null;
    this.clearDiff();
  }
  /**
   * Read the folder already opened in the editor without another installation.
   */
  open() {
    this.filePath = null;
    this.mode = "changes";
    this.dialogTarget.showModal();
    void this.refresh();
  }
  /**
   * Close Git while preserving the currently edited document.
   */
  close() {
    this.dialogTarget.close();
    this.disconnect();
  }
  /**
   * Discard another folder's data and show the new branch immediately.
   */
  async projectChanged() {
    this.disconnect();
    this.main = undefined;
    this.filePath = null;
    this.contentTarget.hidden = true;
    this.controlsTarget.hidden = true;
    this.launchTarget.textContent = "Git";
    const version = this.version;

    try {
      const definition = await gitDirectories(this.project.dirHandle);
      const branch = await gitBranch(definition);

      if (version === this.version) {
        this.launchTarget.textContent = `Git · ${branch}`;
      }
    } catch {
      // The Git view explains a missing repository or extra worktree grant when opened.
    }

    if (this.dialogTarget.open && version === this.version) {
      await this.refresh();
    }
  }
  /**
   * Grant access to shared metadata for a linked Git worktree.
   */
  async chooseMain() {
    try {
      this.main = await showDirectoryPicker({ mode: "read" });
      await this.refresh();
    } catch (error) {
      if (error.name !== "AbortError") {
        this.statusTarget.textContent = error.message;
      }
    }
  }
  /**
   * Reopen live handles and discard cached objects before refreshing disk changes.
   */
  async refresh() {
    this.disconnect();
    const version = this.version;
    this.contentTarget.hidden = true;
    this.mainFolderTarget.hidden = true;
    this.statusTarget.textContent = "Читаем Git…";
    try {
      const definition = await gitDirectories(this.project.dirHandle, this.main);

      if (version !== this.version) {
        return;
      }

      await this.initializeReader(definition);
      if (version !== this.version) {
        return;
      }

      await this.load(
        [
          "repository",
        ],
        (data) => this.renderRepository(data),
      );
      if (this.filePath && this.reader && this.dialogTarget.open) {
        await this.loadFileHistory();
      }
    } catch (error) {
      if (version !== this.version) {
        return;
      }

      this.mainFolderTarget.hidden = error.code !== "WORKTREE";
      this.statusTarget.textContent = error.message;
    }
  }
  /**
   * Load the comparison UI and Git worker only when opening an authorized repository.
   *
   * @param {object} definition - Granted repository directory handles.
   */
  async initializeReader(definition) {
    this.reader = new GitReader();

    const [
      module,
    ] = await Promise.all([
      import("../git/diff-view.js"),
      this.reader.request("initialize", definition),
    ]);

    this.DiffView = module.DiffView;
  }
  /**
   * Apply only the latest selection, even when earlier reads finish later.
   *
   * @param {Array} request - Fixed read operation and its selection arguments.
   * @param {(data: object) => void} render - Render the current response.
   */
  async load(request, render) {
    const version = ++this.version;
    this.patchTarget.setAttribute("aria-busy", "true");
    if (!this.contentTarget.hidden) {
      this.statusTarget.textContent = "";
    }

    try {
      const data = await this.reader.request(...request);

      if (version === this.version) {
        this.statusTarget.textContent = data.warning || "";
        this.patchTarget.setAttribute("aria-busy", "false");
        render(data);
      }
    } catch (error) {
      if (version === this.version) {
        this.patchTarget.setAttribute("aria-busy", "false");
        this.statusTarget.textContent = error.message;
      }
    }
  }
  /**
   * Display the currently opened folder, branch and independently loaded history.
   *
   * @param {object} data - Repository identity, status and first history page.
   */
  renderRepository(data) {
    this.controlsTarget.hidden = false;
    this.contentTarget.hidden = false;
    this.repositoryTarget.textContent = data.root;
    this.branchTarget.textContent = data.branch;
    this.launchTarget.textContent = `Git · ${data.branch}`;
    this.launchTarget.title = data.root;
    this.changesTarget.replaceChildren();
    if (data.changes) {
      this.renderChanges(data.changes);
      if (data.warning && data.changes.length === 0) {
        this.changesTarget.textContent = "Нет изменений в доступных файлах.";
      }
    }

    this.renderSidebar(data);

    this.renderPlaceholder(data);
    if (!this.dialogTarget.open) {
      return;
    }

    if (this.mode === "changes") {
      this.selectInitialChange();

      return;
    }

    if (!this.filePath) {
      this.selectHistory();
    }
  }
  /**
   * Give clean and unreadable repositories distinct, useful empty states.
   *
   * @param {object} data - Current repository status.
   */
  renderPlaceholder(data) {
    this.headingTarget.textContent = this.filePath || "Изменения в проекте";
    let message = "Выберите файл для сравнения.";

    if (data.changes?.length === 0) {
      message = "Нет локальных изменений.";
    }

    if (data.changes === null) {
      message = "Не удалось прочитать изменения.";
    }

    this.renderPatch({ patch: message });
  }
  /**
   * Reset sidebar lists and preserve the intended file-history scope.
   *
   * @param {object} data - Repository history page.
   */
  renderSidebar(data) {
    this.commitsTarget.replaceChildren();
    this.commitFilesTarget.hidden = true;
    this.updateMode();
    this.workingVersionTarget.hidden = !this.filePath;
    this.fileHistoryTitleTarget.textContent = this.filePath
      ? `История · ${this.filePath}`
      : "История коммитов";
    if (!this.filePath) {
      this.renderHistory(data);
    }
  }
  /**
   * Open the current file's working changes, or the first available comparison.
   */
  selectInitialChange() {
    const buttons = [
      ...this.changesTarget.querySelectorAll("button"),
    ];

    const current = buttons.find(
      (button) => button.dataset.path === this.project.currentPath && button.dataset.area === "working",
    );

    const working = buttons.find((button) => button.dataset.area === "working");
    const selected = current || working || buttons[0];

    if (selected) {
      void this.compareChange(selected);
    }
  }
  /**
   * Keep index and worktree changes separate, including both versions of one file.
   *
   * @param {Array<object>} changes - Git porcelain records with literal paths.
   */
  renderChanges(changes) {
    for (const [
      area,
      title,
      field,
    ] of CHANGE_GROUPS) {
      const files = changes.filter((file) => {
        if (area === "untracked") {
          return file.staged === "?";
        }

        return file[field] !== " " && file.staged !== "?";
      });

      if (files.length === 0) {
        continue;
      }

      this.changesTarget.append(textNode("h3", title));
      for (const file of files) {
        const button = fileRow({ path: file.path, status: file[field] }, "git#selectChange");
        button.dataset.area = area;
        this.changesTarget.append(button);
      }
    }

    selectRow(this.changesTarget, null);
    if (changes.length === 0) {
      this.changesTarget.append(textNode("p", "Нет изменений. Рабочая папка чистая."));
    }
  }
  /**
   * Append one history page with accessible commit labels and a load-more action.
   *
   * @param {object} data - Commit summaries and whether another page exists.
   */
  renderHistory(data) {
    for (const commit of data.commits) {
      const button = textNode("button", commit.subject);
      button.type = "button";
      button.dataset.action = "git#selectCommit";
      button.dataset.oid = commit.oid;
      const description = `${commit.oid.slice(0, SHORT_OID_LENGTH)} · ${commit.author} · ${new Date(commit.date).toLocaleDateString("ru")}`;
      button.append(textNode("small", description));
      this.commitsTarget.append(button);
    }

    selectRow(this.commitsTarget, this.commitsTarget.querySelector(CURRENT_ROW));
    this.moreTarget.hidden = !data.more;
    if (this.commitsTarget.childElementCount) {
      return;
    }

    const message = this.filePath ? "У этого файла пока нет коммитов." : "В репозитории пока нет коммитов.";
    this.commitsTarget.append(textNode("p", message));
  }
  /**
   * Ask Git for changes between the index and worktree, or HEAD and index.
   *
   * @param {Event} event - Selection from the status list.
   */
  async selectChange(event) {
    await this.compareChange(event.currentTarget);
  }
  /**
   * Compare the selected file without relying on asynchronous DOM action binding.
   *
   * @param {HTMLButtonElement} button - Selected file row with its comparison area.
   */
  async compareChange(button) {
    const { path, area } = button.dataset;
    this.headingTarget.textContent = path;
    this.setVersions(
      area === "staged" ? "Последний коммит · HEAD" : "Индекс · staged",
      area === "staged" ? "Индекс · staged" : "Рабочая копия",
    );
    selectRow(this.changesTarget, button);
    this.clearDiff();
    this.commitFilesTarget.hidden = true;
    await this.load(
      [
        "diff",
        { path, area },
      ],
      (data) => this.renderPatch(data),
    );
  }
  /**
   * Show the selected commit's patch relative to its first parent.
   *
   * @param {Event} event - Selection from the history list.
   */
  async selectCommit(event) {
    await this.compareCommitRow(event.currentTarget);
  }
  /**
   * Show the selected historical revision and keep its commit visibly selected.
   *
   * @param {HTMLButtonElement} button - Selected commit row.
   */
  async compareCommitRow(button) {
    const oid = button.dataset.oid;
    this.commitOid = oid;
    selectRow(this.commitsTarget, button);
    this.workingVersionTarget.setAttribute(CURRENT_ATTRIBUTE, "false");
    this.setVersions("Предыдущая версия", `Коммит ${oid.slice(0, SHORT_OID_LENGTH)}`);
    this.clearDiff();
    if (this.filePath) {
      await this.load(
        [
          "commitDiff",
          { oid, path: this.filePath },
        ],
        (data) => this.renderPatch(data),
      );

      return;
    }

    await this.load(
      [
        "commit",
        oid,
      ],
      (data) => this.renderCommit(data),
    );
  }
  /**
   * List commit files separately so selecting one reads only its comparison.
   *
   * @param {object} data - Literal paths changed in this commit.
   */
  renderCommit(data) {
    this.commitFileListTarget.replaceChildren();
    for (const path of data.files) {
      this.commitFileListTarget.append(fileRow({ path }, "git#commitFile"));
    }

    this.commitFilesTarget.hidden = data.files.length === 0;
    if (data.files.length === 0) {
      this.renderPatch({ patch: "В этом коммите нет изменений файлов." });

      return;
    }

    selectRow(this.commitFileListTarget, null);
    void this.compareCommitFile(data.files[0]);
  }
  /**
   * Select a file within the chosen commit.
   *
   * @param {Event} event - Selected commit-file row.
   */
  async commitFile(event) {
    await this.compareCommitFile(event.currentTarget.dataset.path);
  }
  /**
   * Compare one commit file while keeping its path and selection visible.
   *
   * @param {string} path - Literal repository-relative file path.
   */
  async compareCommitFile(path) {
    this.headingTarget.textContent = path;

    const row = [
      ...this.commitFileListTarget.querySelectorAll("button"),
    ].find((button) => button.dataset.path === path);

    selectRow(this.commitFileListTarget, row);
    await this.load(
      [
        "commitDiff",
        { oid: this.commitOid, path },
      ],
      (data) => this.renderPatch(data),
    );
  }
  /**
   * Retrieve older commits without loading the entire history into the page.
   */
  async older() {
    const skip = this.commitsTarget.querySelectorAll("button").length;
    await this.load(
      this.filePath
        ? [
            "fileHistory",
            { path: this.filePath, skip },
          ]
        : [
            "history",
            skip,
          ],
      (data) => this.renderHistory(data),
    );
  }
  /**
   * Open the active file's own history directly from its toolbar.
   */
  openFileHistory() {
    this.filePath = this.project.currentPath;
    this.mode = "history";
    this.dialogTarget.showModal();
    void this.refresh();
  }
  /**
   * Read file-specific history and its current changes on initial opening.
   */
  async loadFileHistory() {
    const reader = this.reader;
    this.commitsTarget.replaceChildren();
    await this.load(
      [
        "fileHistory",
        { path: this.filePath, skip: 0 },
      ],
      (data) => this.renderHistory(data),
    );
    if (reader === this.reader && this.dialogTarget.open) {
      await this.showWorking();
    }
  }
  /**
   * Compare the active file's saved contents with HEAD, including staged changes.
   */
  async showWorking() {
    this.headingTarget.textContent = this.filePath;
    this.setVersions("Последний коммит · HEAD", "Рабочая копия");
    selectRow(this.commitsTarget, null);
    this.workingVersionTarget.setAttribute(CURRENT_ATTRIBUTE, "true");
    await this.load(
      [
        "diff",
        { path: this.filePath, area: "file" },
      ],
      (data) => this.renderPatch(data),
    );
  }
  /**
   * Dispose the previous comparison before changing selection or closing.
   */
  clearDiff() {
    this.diffView?.destroy();
    this.diffView = null;
    this.patchTarget.setAttribute("aria-busy", "false");
    this.patchTarget.replaceChildren();
    this.diffControlsTarget.hidden = true;
    this.versionsTarget.hidden = true;
  }
  /**
   * Display aligned read-only versions, or a specific binary/size/error notice.
   *
   * @param {object} data - File versions and their comparison notice.
   */
  renderPatch(data) {
    this.clearDiff();
    this.comparison = data;
    this.patchTarget.classList.toggle("git-empty", data.before === undefined);
    if (data.before === undefined) {
      this.patchTarget.textContent = data.patch || "Нет различий для выбранного сравнения.";

      return;
    }

    this.diffControlsTarget.hidden = false;
    if (!this.hasLayoutPreference) {
      this.isUnified = window.innerWidth <= MOBILE_WIDTH;
    }

    this.versionsTarget.hidden = false;
    this.versionsTarget.dataset.layout = this.isUnified ? "unified" : "split";
    this.diffView = new this.DiffView(this.patchTarget, data, {
      isUnified: this.isUnified,
      hasWrapping: this.hasWrapping,
      onSelection: () => this.updateCounter(),
    });
    this.layoutTarget.value = this.isUnified ? "unified" : "split";
    this.updateCounter();
  }
  /**
   * Toggle between aligned versions and an inline comparison without rereading disk.
   */
  toggleLayout() {
    this.hasLayoutPreference = true;
    this.isUnified = this.layoutTarget.value === "unified";
    this.renderPatch(this.comparison);
  }
  /**
   * Switch the sidebar between changed files and commit history.
   *
   * @param {Event} event - Selected sidebar tab.
   */
  changeMode(event) {
    this.mode = event.currentTarget.dataset.mode;
    this.updateMode();
    if (this.mode === "changes") {
      this.selectInitialChange();

      return;
    }

    this.selectHistory();
  }
  /**
   * Restore a history comparison instead of leaving a working diff under the history tab.
   */
  selectHistory() {
    if (this.filePath && this.workingVersionTarget.getAttribute(CURRENT_ATTRIBUTE) === "true") {
      void this.showWorking();

      return;
    }

    const selected =
      this.commitsTarget.querySelector(CURRENT_ROW) || this.commitsTarget.querySelector("button");

    if (selected) {
      void this.compareCommitRow(selected);

      return;
    }

    this.renderPatch({ patch: "В репозитории пока нет коммитов." });
  }
  /**
   * Keep tabs and their panels consistent without mixing two navigation tasks.
   */
  updateMode() {
    const isHistory = this.mode === "history";
    this.changeSectionTarget.hidden = isHistory;
    this.historySectionTarget.hidden = !isHistory;
    this.changesTabTarget.setAttribute("aria-selected", String(!isHistory));
    this.historyTabTarget.setAttribute("aria-selected", String(isHistory));
    this.changesTabTarget.tabIndex = isHistory ? -1 : 0;
    this.historyTabTarget.tabIndex = isHistory ? 0 : -1;
  }
  /**
   * Name the exact sources compared in the two panes.
   *
   * @param {string} before - Left-side revision label.
   * @param {string} after - Right-side revision label.
   */
  setVersions(before, after) {
    this.beforeLabelTarget.textContent = before;
    this.afterLabelTarget.textContent = after;
  }
  /**
   * Report changed-block position and disable meaningless navigation in clean files.
   */
  updateCounter() {
    if (!this.diffView) {
      return;
    }

    const { current, total } = this.diffView.position;
    this.counterTarget.textContent = total ? `${current} / ${total}` : "Нет изменений";
    this.previousTarget.disabled = total === 0;
    this.nextTarget.disabled = total === 0;
  }
  /**
   * Make long text readable without horizontal scrolling.
   */
  toggleWrapping() {
    this.hasWrapping = !this.hasWrapping;
    this.wrappingTarget.setAttribute("aria-pressed", String(this.hasWrapping));
    this.renderPatch(this.comparison);
  }
  /**
   * Move through sidebar items with the keyboard.
   *
   * @param {KeyboardEvent} event - Navigation key from a file or commit list.
   */
  navigateList(event) {
    navigateRows(event);
  }
  /**
   * Choose a readable default when the viewport becomes narrow.
   */
  resizeDiff() {
    if (!this.diffView || this.hasLayoutPreference) {
      return;
    }

    const isUnified = window.innerWidth <= MOBILE_WIDTH;

    if (this.isUnified === isUnified) {
      return;
    }

    this.isUnified = isUnified;
    this.renderPatch(this.comparison);
  }
  /**
   * Switch sidebar tabs with the keyboard.
   *
   * @param {KeyboardEvent} event - Keyboard input from the tab bar.
   */
  changeTab(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    const tab = event.key === "ArrowRight" ? this.historyTabTarget : this.changesTabTarget;
    tab.focus();
    tab.click();
  }
  /**
   * Keep change-navigation shortcuts available throughout the open diff dialog.
   *
   * @param {KeyboardEvent} event - Keyboard input from any dialog control.
   */
  diffKeydown(event) {
    if (event.key !== "F7" || event.defaultPrevented || !this.diffView) {
      return;
    }

    event.preventDefault();
    this.diffView.navigate(event.shiftKey);
  }
  /**
   * Move to the next changed block, also available with F7.
   */
  nextChange() {
    this.diffView?.navigate(false);
    this.updateCounter();
  }
  /**
   * Move to the previous changed block, also available with Shift+F7.
   */
  previousChange() {
    this.diffView?.navigate(true);
    this.updateCounter();
  }
}
