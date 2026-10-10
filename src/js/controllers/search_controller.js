import { searchProject } from "../search/search.js";

import WorkspaceComponent from "./workspace_component.js";

const DOUBLE_SHIFT_DELAY = 450;
const SEARCH_DELAY = 120;
const SEARCH_RESULT_LIMIT = 100;

/**
 * Highlight the first query occurrence using text nodes.
 *
 * @param {HTMLElement} element - Element receiving the rendered text.
 * @param {string} text - Current file contents.
 * @param {string} query - Normalized search text.
 */
function highlight(element, text, query) {
  const index = query ? text.toLocaleLowerCase().indexOf(query) : -1;

  if (index < 0) {
    element.textContent = text;

    return;
  }

  element.append(document.createTextNode(text.slice(0, index)));
  const mark = document.createElement("mark");
  mark.textContent = text.slice(index, index + query.length);
  element.append(mark, document.createTextNode(text.slice(index + query.length)));
}

export default class SearchController extends WorkspaceComponent {
  static targets = [
    "searchDialog",
    "searchInput",
    "searchResults",
    "searchInfo",
  ];
  /**
   * Create the state owned by this component.
   */
  initialize() {
    this.searchVersion = 0;
    this.lastShift = 0;
    this._onClose = () => this.invalidate();
    this._onKey = (event) => this.globalKey(event);
  }
  /**
   * Handle global search shortcuts without interfering with repeated keys.
   *
   * @param {Event} event - Browser event triggering this action.
   */
  globalKey(event) {
    this.handleShift(event);
    if (event.key !== "Escape" || !this.searchDialogTarget.open) {
      return;
    }

    event.preventDefault();
    this.closeSearch();
  }
  /**
   * Open search after two unmodified Shift presses.
   *
   * @param {Event} event - Browser event triggering this action.
   */
  handleShift(event) {
    const hasModifier = event.ctrlKey || event.metaKey || event.altKey;

    if (event.key !== "Shift" || event.repeat || hasModifier) {
      this.lastShift = 0;

      return;
    }

    const now = performance.now();

    if (this.lastShift && now - this.lastShift < DOUBLE_SHIFT_DELAY) {
      this.lastShift = 0;
      this.openSearch();

      return;
    }

    this.lastShift = now;
  }
  /**
   * Attach the component to the workspace and register event handlers.
   */
  connect() {
    this.searchDialogTarget.addEventListener("close", this._onClose);
    document.addEventListener("keydown", this._onKey);
  }
  /**
   * Release the component resources and remove event handlers.
   */
  disconnect() {
    this.searchVersion++;
    clearTimeout(this.searchTimer);
    this.searchDialogTarget.removeEventListener("close", this._onClose);
    document.removeEventListener("keydown", this._onKey);
  }
  /**
   * Cancel pending searches and invalidate their results.
   */
  invalidate() {
    this.searchVersion++;
    clearTimeout(this.searchTimer);
  }
  /**
   * Report whether the search dialog is open.
   *
   * @returns {boolean} Whether the search dialog is open.
   */
  get isOpen() {
    return this.searchDialogTarget.open;
  }
  /**
   * Open the project search dialog and focus its input.
   */
  openSearch() {
    if (this.workspace.tree.hasOpenDialog || this.searchDialogTarget.open) {
      return;
    }

    this.workspace.tree.closeContextMenu();
    this.searchDialogTarget.showModal();
    this.searchInputTarget.focus();
    this.queueSearch();
  }

  /**
   * Close the search dialog and cancel pending work.
   */
  closeSearch() {
    this.searchDialogTarget.close();
  }

  /**
   * Debounce a new search for the current input.
   */
  queueSearch() {
    clearTimeout(this.searchTimer);
    const version = ++this.searchVersion;
    this.searchMatches = [];
    this.searchResultsTarget.replaceChildren();
    this.searchInfoTarget.textContent = "Поиск…";
    this.searchTimer = setTimeout(() => this.runSearch(version), SEARCH_DELAY);
  }

  /**
   * Compile project exclusions while this search remains current.
   *
   * @param {number} version - Search generation captured before asynchronous work.
   * @returns {Promise<((path: string, kind?: string) => boolean)|null>} Current ignore predicate, or null after search cancellation.
   */
  searchExclusions(version) {
    return this.project.exclusions(
      () => version === this.searchVersion && this.searchDialogTarget.open,
      (path, node) => this.workspace.readText(path, node),
    );
  }

  /**
   * Search the project and render the current results.
   *
   * @param {number} version - Search generation captured before asynchronous work.
   */
  async runSearch(version) {
    const query = this.searchInputTarget.value.trim().toLocaleLowerCase();
    let excluded;

    try {
      excluded = await this.searchExclusions(version);
    } catch (error) {
      if (this.isCurrentSearch(version)) {
        this.searchInfoTarget.textContent = `Не удалось применить правила .gitignore. Поиск остановлен: ${this.workspace.errMsg(error)}`;
      }

      return;
    }

    if (!excluded || !this.isCurrentSearch(version)) {
      return;
    }

    const result = await searchProject(this.project, {
      query,
      excluded,
      isCurrent: () => this.isCurrentSearch(version),
      readText: (path, node) => this.workspace.readSearchText(path, node),
    });

    if (result) {
      this.renderResults(result, query);
    }
  }
  /**
   * Check that the search generation and dialog are still active.
   *
   * @param {number} version - Search generation captured before asynchronous work.
   * @returns {boolean} Whether the dialog still owns this search generation.
   */
  isCurrentSearch(version) {
    return version === this.searchVersion && this.searchDialogTarget.open;
  }
  /**
   * Render a bounded result list and report unreadable files.
   *
   * @param {object} result - Completed read or file operation result.
   * @param {string} query - Normalized search text.
   */
  renderResults(result, query) {
    const { matches, unreadable } = result;
    this.searchMatches = matches.slice(0, SEARCH_RESULT_LIMIT);
    this.searchIndex = 0;
    this.searchResultsTarget.replaceChildren();
    for (const [
      index,
      match,
    ] of this.searchMatches.entries()) {
      this.searchResultsTarget.append(this.buildResult(match, index, query));
    }

    if (matches.length === 0) {
      this.renderEmpty(query);
    }

    this.searchInputTarget.setAttribute("aria-activedescendant", matches.length > 0 ? "search-result-0" : "");
    const truncated = matches.length > SEARCH_RESULT_LIMIT ? " · показаны первые 100" : "";
    const failures = unreadable ? ` · не удалось прочитать: ${unreadable}` : "";
    this.searchInfoTarget.textContent = `${matches.length} файлов${truncated}${failures} · ↑ ↓ выбор · Enter открыть`;
  }
  /**
   * Build one accessible search result button.
   *
   * @param {object} match - Matched path, excerpt and character offset.
   * @param {number} index - Index of the selected search result.
   * @param {string} query - Normalized search text.
   * @returns {HTMLButtonElement} Accessible search result button.
   */
  buildResult(match, index, query) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    button.id = `search-result-${index}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", index === 0);
    const path = document.createElement("span");
    path.className = "search-path";
    highlight(path, match.path, query);
    button.append(path);
    if (match.excerpt) {
      const excerpt = document.createElement("span");
      excerpt.className = "search-excerpt";
      highlight(excerpt, match.excerpt, query);
      button.append(excerpt);
    }

    button.addEventListener("click", () => this.openSearchMatch(index));

    return button;
  }
  /**
   * Explain why the search result list is empty.
   *
   * @param {string} query - Normalized search text.
   */
  renderEmpty(query) {
    const empty = document.createElement("p");
    empty.className = "search-info";
    empty.textContent = query ? "Ничего не найдено" : "Откройте проект, чтобы искать файлы";
    this.searchResultsTarget.append(empty);
  }

  /**
   * Handle keyboard navigation through search results.
   *
   * @param {Event} event - Browser event triggering this action.
   */
  searchKey(event) {
    if (
      ![
        "ArrowDown",
        "ArrowUp",
        "Enter",
      ].includes(event.key)
    ) {
      return;
    }

    event.preventDefault();
    if (!this.searchMatches?.length) {
      return;
    }

    if (event.key === "Enter") {
      this.openSearchMatch(this.searchIndex);

      return;
    }

    this.searchIndex = Math.max(
      0,
      Math.min(this.searchMatches.length - 1, this.searchIndex + (event.key === "ArrowDown" ? 1 : -1)),
    );
    const options = this.searchResultsTarget.querySelectorAll('[role="option"]');

    for (const [
      index,
      option,
    ] of options.entries()) {
      option.setAttribute("aria-selected", index === this.searchIndex);
    }

    options[this.searchIndex]?.scrollIntoView({ block: "nearest" });
    this.searchInputTarget.setAttribute("aria-activedescendant", `search-result-${this.searchIndex}`);
  }

  /**
   * Open a result and reveal its matching text.
   *
   * @param {number} index - Index of the selected search result.
   */
  async openSearchMatch(index) {
    const match = this.searchMatches?.[index];

    if (!match) {
      return;
    }

    this.closeSearch();
    await this.workspace.openNode(match.path);
    if (this.project.currentPath === match.path) {
      this.workspace.editor.revealMatch(match.offset);
    }
  }
}
