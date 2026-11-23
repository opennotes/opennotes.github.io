import { gitBranch, gitDirectories } from "../git/metadata.js";
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
    "fileSelect",
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
    this.isUnified = false;
    this.DiffView = null;
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
    this.statusTarget.textContent = "Читаем Git…";
    try {
      const data = await this.reader.request(...request);

      if (version === this.version) {
        render(data);
        this.statusTarget.textContent = data.warning || "";
      }
    } catch (error) {
      if (version === this.version) {
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
    this.repositoryTarget.textContent = `${data.root} · ${data.branch}`;
    this.launchTarget.textContent = `Git · ${data.branch}`;
    this.launchTarget.title = data.root;
    this.changesTarget.replaceChildren();
    if (data.changes) {
      this.renderChanges(data.changes);
      if (data.warning && data.changes.length === 0) {
        this.changesTarget.textContent = "Нет изменений в доступных файлах.";
      }
    }

    this.commitsTarget.replaceChildren();
    this.fileSelectTarget.hidden = true;
    this.changeSectionTarget.hidden = Boolean(this.filePath);
    this.workingVersionTarget.hidden = !this.filePath;
    this.fileHistoryTitleTarget.textContent = this.filePath
      ? `История · ${this.filePath}`
      : "История коммитов";
    if (!this.filePath) {
      this.renderHistory(data);
    }

    this.headingTarget.textContent = `Ветка: ${data.branch}`;
    this.renderPatch({ patch: "Выберите файл для сравнения." });
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
        const previous = file.oldPath ? `${file.oldPath} → ` : "";
        const button = textNode("button", `${file[field]}  ${previous}${file.path}`);

        button.type = "button";
        button.dataset.action = "git#selectChange";
        button.dataset.path = file.path;
        button.dataset.area = area;
        this.changesTarget.append(button);
      }
    }

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

    this.moreTarget.hidden = !data.more;
    if (!this.commitsTarget.childElementCount) {
      this.commitsTarget.append(textNode("p", "В репозитории пока нет коммитов."));
    }
  }
  /**
   * Ask Git for changes between the index and worktree, or HEAD and index.
   *
   * @param {Event} event - Selection from the status list.
   */
  async selectChange(event) {
    const { path, area } = event.currentTarget.dataset;
    this.headingTarget.textContent = `${path} · ${area === "staged" ? "HEAD → индекс" : "индекс → рабочая папка"}`;
    this.clearDiff();
    this.fileSelectTarget.hidden = true;
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
    const oid = event.currentTarget.dataset.oid;
    this.commitOid = oid;
    this.headingTarget.textContent = `Коммит ${oid.slice(0, SHORT_OID_LENGTH)}`;
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
    this.fileSelectTarget.replaceChildren();
    for (const path of data.files) {
      const option = textNode("option", path);
      option.value = path;
      this.fileSelectTarget.append(option);
    }

    this.fileSelectTarget.hidden = data.files.length === 0;
    if (data.files.length > 0) {
      void this.commitFile();
    }
  }
  /**
   * Compare the selected commit file with its first-parent version.
   */
  async commitFile() {
    const path = this.fileSelectTarget.value;
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
    this.headingTarget.textContent = `${this.filePath} · HEAD → рабочая версия`;
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
    if (data.before === undefined) {
      this.patchTarget.textContent = data.patch || "Нет различий для выбранного сравнения.";

      return;
    }

    this.diffControlsTarget.hidden = false;
    this.versionsTarget.hidden = this.isUnified;
    this.diffView = new this.DiffView(this.patchTarget, data, this.isUnified);
    this.layoutTarget.textContent = this.isUnified ? "Две колонки" : "Единый вид";
  }
  /**
   * Toggle between aligned versions and an inline comparison without rereading disk.
   */
  toggleLayout() {
    this.isUnified = !this.isUnified;
    this.renderPatch(this.comparison);
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
  }
  /**
   * Move to the previous changed block, also available with Shift+F7.
   */
  previousChange() {
    this.diffView?.navigate(true);
  }
}
