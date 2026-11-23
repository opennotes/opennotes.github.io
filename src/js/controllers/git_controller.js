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

const MAX_PATCH_LINES = 5000;
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

/**
 * Classify unified diff lines without interpreting their contents.
 *
 * @param {string} line - One literal Git patch line.
 * @returns {string} Decorative class for an addition, removal or hunk.
 */
function patchClass(line) {
  if (line.startsWith("+")) {
    return "git-added";
  }

  if (line.startsWith("-")) {
    return "git-removed";
  }

  if (line.startsWith("@@")) {
    return "git-hunk";
  }

  return "";
}

/**
 * Group neighboring lines to keep large patches small in the DOM.
 *
 * @param {Array<string>} lines - Bounded literal patch lines.
 * @returns {Array<object>} Contiguous runs sharing one diff decoration.
 */
function patchGroups(lines) {
  const groups = [];

  for (const line of lines) {
    const className = patchClass(line);
    const previous = groups.at(-1);

    if (previous?.className === className) {
      previous.text += `${line}\n`;
      continue;
    }

    groups.push({ className, text: `${line}\n` });
  }

  return groups;
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
  ];

  /**
   * Keep canceled requests obsolete after reconnecting or changing folders.
   */
  initialize() {
    this.version = 0;
    this.reader = null;
    this.main = undefined;
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
  }
  /**
   * Read the folder already opened in the editor without another installation.
   */
  open() {
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
    this.controlsTarget.hidden = true;
    this.mainFolderTarget.hidden = true;
    this.statusTarget.textContent = "Читаем Git…";
    try {
      const definition = await gitDirectories(this.project.dirHandle, this.main);

      if (version !== this.version) {
        return;
      }

      this.reader = new GitReader();
      await this.reader.request("initialize", definition);
      if (version !== this.version) {
        return;
      }

      await this.load(
        [
          "repository",
        ],
        (data) => this.renderRepository(data),
      );
    } catch (error) {
      if (version !== this.version) {
        return;
      }

      this.mainFolderTarget.hidden = error.code !== "WORKTREE";
      this.statusTarget.textContent = error.message;
    }
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
    this.renderHistory(data);
    this.headingTarget.textContent = `Ветка: ${data.branch}`;
    this.renderPatch({ patch: "Выберите файл или коммит, чтобы посмотреть diff." });
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
    this.patchTarget.replaceChildren();
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
    this.headingTarget.textContent = `Коммит ${oid.slice(0, SHORT_OID_LENGTH)} · diff с первым родителем`;
    this.patchTarget.replaceChildren();
    await this.load(
      [
        "commit",
        oid,
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
      [
        "history",
        skip,
      ],
      (data) => this.renderHistory(data),
    );
  }
  /**
   * Color a literal unified diff and bound the number of DOM nodes it creates.
   *
   * @param {object} data - Native Git patch, including binary-file messages.
   */
  renderPatch(data) {
    this.patchTarget.replaceChildren();
    const lines = (data.patch || "Нет различий для выбранного сравнения.").split("\n");
    const fragment = document.createDocumentFragment();

    const groups = patchGroups(lines.slice(0, MAX_PATCH_LINES));

    for (const group of groups) {
      const span = textNode("span", group.text);

      span.className = group.className;

      fragment.append(span);
    }

    if (lines.length > MAX_PATCH_LINES) {
      fragment.append(textNode("span", `\nПоказаны первые ${MAX_PATCH_LINES} строк.`));
    }

    this.patchTarget.append(fragment);
  }
}
