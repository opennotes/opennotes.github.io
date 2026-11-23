import { Controller } from "@hotwired/stimulus";

import { parseGitConnection, rememberGitConnection, requestGit, restoreGitConnection } from "../git.js";

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
const REQUEST_TIMEOUT = 30_000;

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

export default class GitController extends Controller {
  static targets = [
    "dialog",
    "form",
    "connection",
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
   * Initialize request versions once so canceled responses remain obsolete after reconnects.
   */
  initialize() {
    this.version = 0;
    this.connection = null;
    this.abort = null;
  }
  /**
   * Reconnect without reusing the version of a canceled response.
   */
  connect() {
    const link = restoreGitConnection();

    if (!link) {
      return;
    }

    this.connectionTarget.value = link;
    this.dialogTarget.showModal();
    void this.connectGit();
  }
  /**
   * Cancel outstanding reads when this controller leaves the page.
   */
  disconnect() {
    this.version++;
    this.abort?.abort();
  }
  /**
   * Open Git for the explicitly connected repository and refresh its disk state.
   */
  open() {
    this.dialogTarget.showModal();
    if (this.connection) {
      void this.refresh();
    }
  }
  /**
   * Close Git while preserving the currently edited document.
   */
  close() {
    this.dialogTarget.close();
    this.disconnect();
  }
  /**
   * Connect only after parsing the helper's restricted loopback link.
   *
   * @param {Event} event - Optional form submission to prevent navigating.
   */
  async connectGit(event) {
    event?.preventDefault();
    try {
      this.connection = parseGitConnection(this.connectionTarget.value.trim());
      await this.refresh();
    } catch {
      this.statusTarget.textContent = "Вставьте адрес подключения, выведенный помощником Open Notes Git.";
    }
  }
  /**
   * Forget this tab's helper connection and remove its data from the view.
   */
  forget() {
    this.disconnect();
    this.connection = null;
    rememberGitConnection("");
    this.connectionTarget.value = "";
    this.formTarget.hidden = false;
    this.controlsTarget.hidden = true;
    this.contentTarget.hidden = true;
    this.repositoryTarget.textContent = "";
    this.launchTarget.textContent = "Git";
    this.statusTarget.textContent = "Git отключён.";
    this.changesTarget.replaceChildren();
    this.commitsTarget.replaceChildren();
    this.moreTarget.hidden = true;
    this.renderPatch({ patch: "" });
  }
  /**
   * Read status and recent history afresh from the system Git.
   */
  async refresh() {
    await this.load("/repository", (data) => this.renderRepository(data));
  }
  /**
   * Ensure that a slower request cannot replace a more recent selection.
   *
   * @param {string} route - Fixed endpoint and encoded repository selection.
   * @param {(data: object) => void} render - View update applied only to the current response.
   */
  async load(route, render) {
    this.abort?.abort();
    this.abort = new AbortController();
    const version = ++this.version;
    this.statusTarget.textContent = "Читаем Git…";
    try {
      const signal = AbortSignal.any([
        this.abort.signal,
        AbortSignal.timeout(REQUEST_TIMEOUT),
      ]);

      const data = await requestGit(this.connection, route, signal);

      if (version === this.version) {
        render(data);
        this.statusTarget.textContent = "";
      }
    } catch (error) {
      if (version === this.version) {
        this.statusTarget.textContent = error.message;
      }
    }
  }
  /**
   * Display the helper's actual repository path so a different folder is unambiguous.
   *
   * @param {object} data - Repository path, branch, status and first history page.
   */
  renderRepository(data) {
    rememberGitConnection(this.connectionTarget.value.trim());
    this.formTarget.hidden = true;
    this.controlsTarget.hidden = false;
    this.contentTarget.hidden = false;
    this.repositoryTarget.textContent = `${data.root} · ${data.branch}`;
    this.launchTarget.textContent = `Git · ${data.branch}`;
    this.launchTarget.title = data.root;
    this.changesTarget.replaceChildren();
    this.renderChanges(data.changes);
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
    const query = new URLSearchParams({ path, area });
    this.headingTarget.textContent = `${path} · ${area === "staged" ? "HEAD → индекс" : "индекс → рабочая папка"}`;
    this.patchTarget.replaceChildren();
    await this.load(`/diff?${query}`, (data) => this.renderPatch(data));
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
    await this.load(`/diff?commit=${oid}`, (data) => this.renderPatch(data));
  }
  /**
   * Retrieve older commits without loading the entire history into the page.
   */
  async older() {
    const skip = this.commitsTarget.querySelectorAll("button").length;
    await this.load(`/history?skip=${skip}`, (data) => this.renderHistory(data));
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
      fragment.append(
        textNode("span", `\nПоказаны первые ${MAX_PATCH_LINES} строк. Полный diff доступен в терминале.`),
      );
    }

    this.patchTarget.append(fragment);
  }
}
