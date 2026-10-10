import { ICO } from "../ui/icons.js";

import WorkspaceComponent from "./workspace_component.js";

const fileNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const TREE_ROW_SELECTOR = ".tree-item";
const SELECTED_ATTRIBUTE = "aria-selected";
const RENAME_LABEL = "Переименовать";
const MENU_MARGIN = 8;
const APP_NAME = "Open Notes";
const LABEL_ATTRIBUTE = "aria-label";
const CONTROL_CHARACTER_LIMIT = 32;

/**
 * Reject directory separators and control characters in a sibling name.
 *
 * @param {string} name - Requested sibling name.
 * @returns {boolean} Whether the name contains a separator or control character.
 */
function hasInvalidFileCharacters(name) {
  return [
    ...name,
  ].some((character) => "/\\".includes(character) || character.codePointAt(0) < CONTROL_CHARACTER_LIMIT);
}

const NAVIGATION_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "Home",
  "End",
  "ArrowRight",
  "ArrowLeft",
  "Enter",
  " ",
]);

/**
 * Order folders first and compare sibling names naturally.
 *
 * @param {object} a - First sibling node being compared.
 * @param {object} b - Second sibling node being compared.
 * @returns {number} Ordering of folders and naturally sorted sibling names.
 */
function compareNodes(a, b) {
  if (a.kind === b.kind) {
    return fileNameCollator.compare(a.name, b.name);
  }

  return a.kind === "directory" ? -1 : 1;
}

/**
 * Choose the folder or file icon for a tree row.
 *
 * @param {object} node - Project node being read or modified.
 * @returns {string} Trusted SVG markup for this node kind.
 */
function nodeIcon(node) {
  if (node.kind === "directory") {
    return ICO.chevron + ICO.folder;
  }

  const icon = /\.(md|markdown|mdx)$/i.test(node.name) ? ICO.md : ICO.file;

  return `<span class="spacer"></span>${icon}`;
}

/**
 * Describe the consequences of renaming or deleting a node.
 *
 * @param {string} kind - File or directory kind.
 * @param {object} node - Project node being read or modified.
 * @param {boolean} isNative - Whether the operation will modify files on disk.
 * @returns {object} Dialog title, consequence description and submit label.
 */
function actionLabels(kind, node, isNative) {
  if (kind === "rename") {
    return {
      title: RENAME_LABEL,
      description: node.name,
      submit: RENAME_LABEL,
    };
  }

  const title = node.kind === "directory" ? "Удалить папку?" : "Удалить файл?";
  const contents = node.kind === "directory" ? " и всё её содержимое" : "";

  const consequence = isNative
    ? " будут удалены с диска без перемещения в корзину."
    : " будут удалены из загруженного проекта. Исходные файлы на диске останутся.";

  return {
    title,
    description: `«${node.name}»${contents}${consequence}`,
    submit: "Удалить",
  };
}

export default class TreeController extends WorkspaceComponent {
  static classes = [
    "active",
    "expanded",
    "directory",
    "dropTarget",
    "rootDropTarget",
  ];

  static targets = [
    "tree",
    "empty",
    "contextMenu",
    "actionDialog",
    "actionTitle",
    "actionDescription",
    "actionInput",
    "actionError",
    "actionSubmit",
  ];
  /**
   * Create the state owned by this component.
   */
  initialize() {
    this.expanded = new Set();
    this.emptyElement = this.emptyTarget;
    this.focusedPath = null;
    this._onCancel = (event) => {
      if (this.project.operationBusy) {
        event.preventDefault();
      }
    };
  }
  /**
   * Attach the component to the workspace and register event handlers.
   */
  connect() {
    this.actionDialogTarget.addEventListener("cancel", this._onCancel);
  }
  /**
   * Release the component resources and remove event handlers.
   */
  disconnect() {
    this.actionDialogTarget.removeEventListener("cancel", this._onCancel);
  }
  /**
   * Report whether a file operation dialog is open.
   *
   * @returns {boolean} Whether a file operation dialog is open.
   */
  get hasOpenDialog() {
    return this.actionDialogTarget.open;
  }
  /**
   * Hide the tree context menu.
   */
  closeContextMenu() {
    this.contextMenuTarget.hidden = true;
  }
  /**
   * Clear state belonging to the previous project.
   */
  reset() {
    this.children = null;
    this.expanded.clear();
    this.focusedPath = null;
  }
  /**
   * Render the current project tree.
   *
   * @param {boolean} shouldRestoreFocus - Whether to restore keyboard focus after rendering.
   */
  refresh(shouldRestoreFocus = false) {
    this.children = null;
    this.renderTree(shouldRestoreFocus);
  }
  /**
   * Reveal a selected path without rebuilding unaffected rows.
   *
   * @param {string} path - Project-relative file or directory path.
   */
  selectPath(path) {
    let ancestor = this.project.nodes.get(path).parentPath;
    let isChanged = false;

    while (ancestor) {
      if (!this.expanded.has(ancestor)) {
        this.expanded.add(ancestor);
        isChanged = true;
      }

      ancestor = this.project.nodes.get(ancestor)?.parentPath;
    }

    this.focusedPath = path;
    if (isChanged) {
      this.renderTree();

      return;
    }

    this.updateTreeSelection(path);
  }
  /**
   * Remap expanded and focused paths after a move.
   *
   * @param {string} path - Project-relative file or directory path.
   * @param {string} newPath - Destination path after the move.
   * @param {string} destination - Project-relative destination directory.
   */
  remapPaths(path, newPath, destination) {
    this.expanded = new Set(
      [
        ...this.expanded,
      ].map((key) => {
        if (key === path || key?.startsWith(`${path}/`)) {
          return newPath + key.slice(path.length);
        }

        return key;
      }),
    );
    this.expanded.add(destination);
    this.focusedPath = newPath;
  }
  /**
   * Remove stale paths from tree navigation state.
   *
   * @param {Iterable<string>} paths - Project paths affected by this operation.
   * @param {string|object} parent - Parent path or destination directory handle.
   */
  removePaths(paths, parent) {
    for (const path of paths) {
      this.expanded.delete(path);
    }

    this.focusedPath = parent;
  }
  /**
   * Render visible project nodes and restore keyboard focus.
   *
   * @param {boolean} shouldRestoreFocus - Whether to restore keyboard focus after rendering.
   */
  renderTree(shouldRestoreFocus = false) {
    const projectName = this.workspace.rootNameTarget.textContent;
    this.workspace.rootNameTarget.title = projectName;
    document.title = projectName === APP_NAME ? APP_NAME : `${projectName} — ${APP_NAME}`;
    this.treeRows = new Map();
    this.treeTarget.setAttribute("role", "tree");
    this.treeTarget.setAttribute(LABEL_ATTRIBUTE, "Файлы проекта");
    if (this.project.nodes.size === 0) {
      this.emptyElement.textContent = "В папке нет файлов";
      this.emptyElement.hidden = false;
      this.treeTarget.replaceChildren(this.emptyElement);

      return;
    }

    this.indexChildren();
    this.renderRootNodes();
    this.restoreTreeFocus(shouldRestoreFocus);
    this.workspace.reader.prefetchVisibleFiles(this.treeRows.keys());
  }
  /**
   * Index and sort child nodes only when the project changes.
   */
  indexChildren() {
    if (this.children && this.treeNodeCount === this.project.nodes.size) {
      return;
    }

    this.children = new Map();
    this.treeNodeCount = this.project.nodes.size;
    for (const [
      path,
      node,
    ] of this.project.nodes) {
      if (!this.children.has(node.parentPath)) {
        this.children.set(node.parentPath, []);
      }

      this.children.get(node.parentPath).push({ ...node, path });
    }

    for (const children of this.children.values()) {
      children.sort((a, b) => compareNodes(a, b));
    }
  }
  /**
   * Replace the tree with rows for the project root.
   */
  renderRootNodes() {
    const fragment = document.createDocumentFragment();
    const roots = this.children.get("") || [];

    for (const node of roots) {
      fragment.append(this.buildNode(node, 1));
    }

    this.treeTarget.replaceChildren(fragment);
  }
  /**
   * Restore roving keyboard focus after rendering rows.
   *
   * @param {boolean} shouldRestoreFocus - Whether to restore keyboard focus after rendering.
   */
  restoreTreeFocus(shouldRestoreFocus) {
    this.selectedTreeRow = this.treeRows.get(this.project.currentPath);
    this.focusedTreeRow = this.treeRows.get(this.focusedPath) || this.treeRows.values().next().value;
    if (this.focusedTreeRow) {
      this.focusedTreeRow.tabIndex = 0;
      this.focusedPath = this.focusedTreeRow.dataset.path;
    }

    if (shouldRestoreFocus) {
      this.focusTreeItem(this.focusedPath);
    }
  }

  /**
   * Create an accessible tree row and its child group.
   *
   * @param {object} node - Project node being read or modified.
   * @param {number} level - Accessible nesting level of the tree row.
   * @returns {HTMLElement} Tree row wrapper with any expanded child group.
   */
  buildNode(node, level) {
    const wrap = document.createElement("div");
    wrap.setAttribute("role", "none");
    wrap.append(this.createTreeRow(node, level));
    if (node.kind === "directory" && this.expanded.has(node.path)) {
      wrap.append(this.createChildGroup(node.path, level));
    }

    return wrap;
  }
  /**
   * Build a tree row and connect its interaction handlers.
   *
   * @param {object} node - Project node being read or modified.
   * @param {number} level - Accessible nesting level of the tree row.
   * @returns {HTMLElement} Accessible tree row with its interaction handlers.
   */
  createTreeRow(node, level) {
    const item = document.createElement("div");
    this.configureTreeRow(item, node, level);
    item.insertAdjacentHTML("beforeend", nodeIcon(node));
    if (node.kind === "directory" && this.expanded.has(node.path)) {
      item.querySelector(".chevron").classList.add(...this.expandedClasses);
    }

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = node.name;
    item.append(label);
    item.addEventListener("focus", () => this.rowFocused(item, node.path));
    item.addEventListener("click", () => this.activateNode(node));
    item.addEventListener("keydown", (event) => this.navigateTree(event, node));
    this.attachRowActions(item, node);
    this.attachDragSource(item, node.path);
    if (this.project.workspaceIsDirectory) {
      this.attachDropTarget(item, node);
    }

    return item;
  }
  /**
   * Apply accessible state and path metadata to a tree row.
   *
   * @param {HTMLElement} item - Tree row configured by this operation.
   * @param {object} node - Project node being read or modified.
   * @param {number} level - Accessible nesting level of the tree row.
   */
  configureTreeRow(item, node, level) {
    const { path } = node;
    const isDirectory = node.kind === "directory";
    item.className = "tree-item";
    if (isDirectory) {
      item.classList.add(...this.directoryClasses);
    }

    if (this.project.currentPath === path) {
      item.classList.add(...this.activeClasses);
    }

    item.dataset.path = path;
    this.treeRows.set(path, item);
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-level", level);
    item.setAttribute(LABEL_ATTRIBUTE, node.name);
    item.title = path;
    item.tabIndex = this.focusedPath === path ? 0 : -1;
    if (isDirectory) {
      item.setAttribute("aria-expanded", this.expanded.has(path));

      return;
    }

    item.setAttribute(SELECTED_ATTRIBUTE, this.project.currentPath === path);
  }
  /**
   * Keep exactly one visible tree row in the tab order.
   *
   * @param {HTMLElement} item - Tree row configured by this operation.
   * @param {string} path - Project-relative file or directory path.
   */
  rowFocused(item, path) {
    this.focusedPath = path;
    if (this.focusedTreeRow && this.focusedTreeRow !== item) {
      this.focusedTreeRow.tabIndex = -1;
    }

    this.focusedTreeRow = item;
    item.tabIndex = 0;
  }
  /**
   * Expand a folder or request opening a file.
   *
   * @param {object} node - Project node being read or modified.
   */
  activateNode(node) {
    this.focusedPath = node.path;
    if (node.kind === "directory") {
      this.toggleExpand(node.path);

      return;
    }

    this.dispatch("select", { detail: { path: node.path } });
  }
  /**
   * Connect the row actions button and context menu.
   *
   * @param {HTMLElement} item - Tree row configured by this operation.
   * @param {object} node - Project node being read or modified.
   */
  attachRowActions(item, node) {
    const actions = document.createElement("button");
    actions.type = "button";
    actions.className = "tree-actions";
    actions.textContent = "⋯";
    actions.setAttribute(LABEL_ATTRIBUTE, `Действия: ${node.name}`);
    actions.addEventListener("click", (event) => {
      event.stopPropagation();
      this.showContextMenu(event, node.path);
    });
    item.append(actions);
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.showContextMenu(event, node.path);
    });
  }
  /**
   * Connect dragging while blocking concurrent file operations.
   *
   * @param {HTMLElement} item - Tree row configured by this operation.
   * @param {string} path - Project-relative file or directory path.
   */
  attachDragSource(item, path) {
    item.draggable = true;
    item.addEventListener("dragstart", (event) => {
      if (this.project.operationBusy) {
        event.preventDefault();

        return;
      }

      this.dragPath = path;
      event.dataTransfer.setData("application/x-project-path", path);
      event.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => {
      this.dragPath = null;
      this.clearDropTargets();
    });
  }
  /**
   * Accept drops into a directory or a file's parent directory.
   *
   * @param {HTMLElement} item - Tree row configured by this operation.
   * @param {object} node - Project node being read or modified.
   */
  attachDropTarget(item, node) {
    const destination = node.kind === "directory" ? node.path : node.parentPath;
    item.addEventListener("dragover", (event) => {
      if (!this.dragPath || this.project.operationBusy) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      this.clearDropTargets();
      item.classList.add(...this.dropTargetClasses);
    });
    item.addEventListener("dragleave", () => item.classList.remove(...this.dropTargetClasses));
    item.addEventListener("drop", (event) => this.dropNode(event, destination));
  }
  /**
   * Commit a row drop and clear its visual feedback.
   *
   * @param {Event} event - Browser event triggering this action.
   * @param {string} destination - Project-relative destination directory.
   */
  dropNode(event, destination) {
    event.preventDefault();
    event.stopPropagation();
    const source = this.dragPath;
    this.dragPath = null;
    this.clearDropTargets();
    if (source) {
      this.workspace.moveNode(source, destination);
    }
  }
  /**
   * Render visible children or an empty folder label.
   *
   * @param {string} path - Project-relative file or directory path.
   * @param {number} level - Accessible nesting level of the tree row.
   * @returns {HTMLElement} Accessible child group for the expanded folder.
   */
  createChildGroup(path, level) {
    const group = document.createElement("div");
    group.className = "tree-children";
    group.setAttribute("role", "group");
    const children = this.children.get(path) || [];

    for (const child of children) {
      group.append(this.buildNode(child, level + 1));
    }

    if (children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tree-folder-empty";
      empty.textContent = "Пустая папка";
      group.append(empty);
    }

    return group;
  }

  /**
   * Update selected rows without rebuilding the tree.
   *
   * @param {string} path - Project-relative file or directory path.
   */
  updateTreeSelection(path) {
    const row = this.treeRows?.get(path);

    if (!row) {
      this.renderTree();

      return;
    }

    if (this.selectedTreeRow && this.selectedTreeRow !== row) {
      this.selectedTreeRow.classList.remove(...this.activeClasses);
      this.selectedTreeRow.setAttribute(SELECTED_ATTRIBUTE, "false");
    }

    if (this.focusedTreeRow && this.focusedTreeRow !== row) {
      this.focusedTreeRow.tabIndex = -1;
    }

    row.classList.add(...this.activeClasses);
    row.setAttribute(SELECTED_ATTRIBUTE, "true");
    row.tabIndex = 0;
    this.selectedTreeRow = row;
    this.focusedTreeRow = row;
  }

  /**
   * Move keyboard focus to a tree row.
   *
   * @param {string} path - Project-relative file or directory path.
   */
  focusTreeItem(path) {
    const row = this.treeRows?.get(path) || this.treeRows?.values().next().value;

    if (!row) {
      this.workspace.openButtonTarget.focus();
    }

    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }

  /**
   * Toggle the expanded state of one directory.
   *
   * @param {string} path - Project-relative file or directory path.
   */
  toggleExpand(path) {
    this.focusedPath = path;
    if (this.expanded.has(path)) {
      this.expanded.delete(path);
      this.renderTree(true);

      return;
    }

    this.expanded.add(path);
    this.renderTree(true);
  }

  /**
   * Apply tree keyboard navigation and file operation shortcuts.
   *
   * @param {Event} event - Browser event triggering this action.
   * @param {object} node - Project node being read or modified.
   */
  navigateTree(event, node) {
    if (
      event.target.closest(".tree-actions") ||
      this.actionShortcut(event, node) ||
      !NAVIGATION_KEYS.has(event.key)
    ) {
      return;
    }

    const rows = [
      ...this.treeTarget.querySelectorAll(TREE_ROW_SELECTOR),
    ];

    const index = rows.indexOf(event.currentTarget);
    const target = this.navigationTarget(event.key, node, { rows, index });
    event.preventDefault();
    target?.focus();
  }
  /**
   * Handle rename and deletion keyboard shortcuts.
   *
   * @param {Event} event - Browser event triggering this action.
   * @param {object} node - Project node being read or modified.
   * @returns {boolean} Whether a rename or deletion shortcut was handled.
   */
  actionShortcut(event, node) {
    if (!node.path) {
      return false;
    }

    if (event.key === "F2") {
      event.preventDefault();
      this.contextPath = node.path;
      this.renameSelected();

      return true;
    }

    if (event.key === "Delete") {
      event.preventDefault();
      this.contextPath = node.path;
      this.deleteSelected();

      return true;
    }

    return false;
  }
  /**
   * Choose the row or action for a recognized navigation key.
   *
   * @param {string} key - Keyboard navigation key.
   * @param {object} node - Project node being read or modified.
   * @param {object} position - Visible rows and the current row index.
   * @returns {HTMLElement|undefined} Next visible row, or undefined when a tree action was applied.
   */
  navigationTarget(key, node, position) {
    const { rows, index } = position;

    const directTargets = {
      ArrowDown: rows[Math.min(index + 1, rows.length - 1)],
      ArrowUp: rows[Math.max(index - 1, 0)],
      Home: rows[0],
      End: rows.at(-1),
    };

    const target = directTargets[key];

    if (target) {
      return target;
    }

    if (key === "ArrowRight") {
      return this.expandOrDescend(node, position);
    }

    if (key === "ArrowLeft") {
      this.collapseOrAscend(node);

      return;
    }

    this.activateNode(node);
  }
  /**
   * Expand a directory or focus its first visible child.
   *
   * @param {object} node - Project node being read or modified.
   * @param {object} position - Visible rows and the current row index.
   * @returns {HTMLElement|undefined} First child row, or undefined after expansion or for a file.
   */
  expandOrDescend(node, position) {
    if (node.kind !== "directory") {
      return;
    }

    if (this.expanded.has(node.path)) {
      return position.rows[position.index + 1];
    }

    this.toggleExpand(node.path);
  }
  /**
   * Collapse a directory or focus its parent.
   *
   * @param {object} node - Project node being read or modified.
   */
  collapseOrAscend(node) {
    if (node.kind === "directory" && this.expanded.has(node.path)) {
      this.toggleExpand(node.path);

      return;
    }

    if (node.parentPath) {
      this.focusTreeItem(node.parentPath);
    }
  }

  /**
   * Accept a dragged project node over the project root.
   *
   * @param {Event} event - Browser event triggering this action.
   */
  rootDragOver(event) {
    const isRootTarget = !event.target.closest(TREE_ROW_SELECTOR) && this.project.workspaceIsDirectory;
    const canDrop = Boolean(this.dragPath) && !this.project.operationBusy;

    if (!isRootTarget || !canDrop) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    this.clearDropTargets();
    event.currentTarget.classList.add(...this.rootDropTargetClasses);
  }

  /**
   * Clear root drop feedback after the pointer leaves it.
   *
   * @param {Event} event - Browser event triggering this action.
   */
  rootDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      event.currentTarget.classList.remove(...this.rootDropTargetClasses);
    }
  }

  /**
   * Move a dragged node into the project root.
   *
   * @param {Event} event - Browser event triggering this action.
   */
  rootDrop(event) {
    if (event.target.closest(".tree-item") || !this.project.workspaceIsDirectory || !this.dragPath) {
      return;
    }

    event.preventDefault();
    const path = this.dragPath;
    this.dragPath = null;
    this.clearDropTargets();
    this.workspace.moveNode(path, "");
  }

  /**
   * Remove visual feedback from all drop targets.
   */
  clearDropTargets() {
    const rows = this.workspace.appTarget.querySelectorAll("[class]");

    for (const row of rows) {
      row.classList.remove(...this.dropTargetClasses, ...this.rootDropTargetClasses);
    }
  }

  /**
   * Position and open file actions for the requested node.
   *
   * @param {Event} event - Browser event triggering this action.
   * @param {string} path - Project-relative file or directory path.
   */
  showContextMenu(event, path) {
    this.contextPath = path;
    const menu = this.contextMenuTarget;
    menu.hidden = false;
    const rect = event.currentTarget.getBoundingClientRect();
    menu.style.left = `${Math.max(MENU_MARGIN, Math.min(event.clientX || rect.right, innerWidth - menu.offsetWidth - MENU_MARGIN))}px`;
    menu.style.top = `${Math.max(MENU_MARGIN, Math.min(event.clientY || rect.bottom, innerHeight - menu.offsetHeight - MENU_MARGIN))}px`;
    menu.querySelector("button").focus();
  }

  /**
   * Open the rename dialog for the selected node.
   */
  renameSelected() {
    this.startAction("rename");
  }

  /**
   * Open the deletion dialog for the selected node.
   */
  deleteSelected() {
    this.startAction("delete");
  }

  /**
   * Configure and open a file operation dialog.
   *
   * @param {string} kind - File or directory kind.
   */
  startAction(kind) {
    this.contextMenuTarget.hidden = true;
    const node = this.project.nodes.get(this.contextPath);

    if (!node || this.project.operationBusy) {
      return;
    }

    const hasWriter = node.handle && typeof node.handle.createWritable === "function";

    if (hasWriter && !this.project.dirHandle) {
      this.workspace.showToast("Для переименования и удаления на диске откройте содержащую файл папку.");

      return;
    }

    this.pendingAction = { kind, path: this.contextPath };
    this.configureAction(kind, node);
    this.actionDialogTarget.showModal();
    if (kind === "rename") {
      this.selectFileName(node);
    }
  }
  /**
   * Populate the file operation dialog without opening it.
   *
   * @param {string} kind - File or directory kind.
   * @param {object} node - Project node being read or modified.
   */
  configureAction(kind, node) {
    const labels = actionLabels(kind, node, Boolean(this.project.dirHandle));
    this.actionTitleTarget.textContent = labels.title;
    this.actionDescriptionTarget.textContent = labels.description;
    this.actionInputTarget.hidden = kind !== "rename";
    this.actionInputTarget.value = node.name;
    this.actionErrorTarget.textContent = "";
    this.actionSubmitTarget.textContent = labels.submit;
    this.actionSubmitTarget.disabled = false;
  }
  /**
   * Select the basename while preserving an existing extension.
   *
   * @param {object} node - Project node being read or modified.
   */
  selectFileName(node) {
    this.actionInputTarget.focus();
    const dot = node.name.lastIndexOf(".");
    const hasExtension = node.kind === "file" && dot > 0;
    const selectionEnd = hasExtension ? dot : node.name.length;
    this.actionInputTarget.setSelectionRange(0, selectionEnd);
  }

  /**
   * Close the file operation dialog without changing files.
   */
  cancelAction() {
    if (!this.project.operationBusy) {
      this.actionDialogTarget.close();
    }
  }

  /**
   * Validate and apply the requested file operation.
   *
   * @param {Event} event - Browser event triggering this action.
   */
  async submitAction(event) {
    event.preventDefault();
    if (this.project.operationBusy || !this.pendingAction) {
      return;
    }

    const { kind, path } = this.pendingAction;
    const node = this.project.nodes.get(path);

    if (!node) {
      this.actionDialogTarget.close();

      return;
    }

    try {
      this.actionSubmitTarget.disabled = true;
      await this.applyAction(kind, path, node);
      this.actionDialogTarget.close();
    } catch (error) {
      this.actionErrorTarget.textContent = this.workspace.errMsg(error);
    } finally {
      this.actionSubmitTarget.disabled = false;
    }
  }
  /**
   * Validate a rename or apply the requested deletion.
   *
   * @param {string} kind - File or directory kind.
   * @param {string} path - Project-relative file or directory path.
   * @param {object} node - Project node being read or modified.
   */
  async applyAction(kind, path, node) {
    if (kind !== "rename") {
      await this.workspace.removeNode(path);

      return;
    }

    const name = this.actionInputTarget.value.trim();
    const hasInvalidCharacters = hasInvalidFileCharacters(name);

    const isReservedName = name === "." || name === "..";
    const hasInvalidName = !name || hasInvalidCharacters;

    if (hasInvalidName || isReservedName) {
      throw new Error("Введите имя без слешей и управляющих символов.");
    }

    await this.workspace.moveNode(path, node.parentPath, { requestedName: name, shouldPropagate: true });
  }
}
