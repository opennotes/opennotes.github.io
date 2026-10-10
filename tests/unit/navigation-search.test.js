import { beforeEach, afterEach, it, expect, vi, describe } from "vitest";

import { mount, fileHandle, directory, project } from "../support/workspace.js";

let c, app;
beforeEach(async () => {
  ({ c, app } = await mount());
});
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search");
  app.stop();
});
const event = (target, extra = {}) => ({
  target,
  currentTarget: target,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  dataTransfer: { setData: vi.fn() },
  ...extra,
});
async function notes() {
  await project(
    c,
    directory("Notes", [
      directory("Folder", [fileHandle("B.md", "needle content")]),
      directory("Empty"),
      fileHandle("A.md", "Alpha"),
      fileHandle("Z.txt", "needle"),
    ]),
  );
}
function key(path, keyValue, target) {
  const row = c.tree.treeRows.get(path);
  c.tree.navigateTree(event(target || row, { currentTarget: row, key: keyValue }), {
    ...c.project.nodes.get(path),
    path,
  });
}
function drag(row, type, extra = {}) {
  const dragEvent = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(dragEvent, { dataTransfer: { setData: vi.fn() }, ...extra });
  row.dispatchEvent(dragEvent);
  return dragEvent;
}
describe("Tree navigation and dragging", () => {
  it("renders empty tree, project titles and numeric file order", () => {
    c.tree.renderTree();
    expect(c.tree.emptyTarget.textContent).toContain("нет файлов");
    c.rootNameTarget.textContent = "Custom";
    c.project.nodes = new Map([
      ["Note10.md", { kind: "file", name: "Note10.md", parentPath: "", handle: fileHandle("Note10.md") }],
      ["Note2.md", { kind: "file", name: "Note2.md", parentPath: "", handle: fileHandle("Note2.md") }],
    ]);
    c.tree.renderTree();
    expect(document.title).toBe("Custom — Open Notes");
    expect([...c.tree.treeRows.keys()]).toEqual(["Note2.md", "Note10.md"]);
  });
  it("focuses visible rows or falls back to the open button", async () => {
    c.tree.focusTreeItem("none");
    expect(document.activeElement).toBe(c.openButtonTarget);
    await notes();
    c.tree.focusTreeItem("none");
    expect(document.activeElement).toBe(c.tree.treeRows.values().next().value);
    c.tree.focusTreeItem("A.md");
    expect(document.activeElement).toBe(c.tree.treeRows.get("A.md"));
    c.tree.updateTreeSelection("none");
    expect(c.tree.treeRows.size).toBe(4);
  });
  it("renders expanded and empty groups", async () => {
    await notes();
    c.tree.toggleExpand("Folder");
    expect(c.tree.treeRows.has("Folder/B.md")).toBe(true);
    c.tree.toggleExpand("Empty");
    expect(c.tree.treeTarget.textContent).toContain("Пустая папка");
    c.tree.toggleExpand("Folder");
    expect(c.tree.treeRows.has("Folder/B.md")).toBe(false);
    c.tree.toggleExpand("Folder");
    c.tree.updateTreeSelection("Folder/B.md");
    c.tree.updateTreeSelection("Folder/B.md");
    expect(c.tree.treeRows.get("Folder/B.md").getAttribute("aria-selected")).toBe("true");
  });
  it("supports arrows, Home, End and boundaries", async () => {
    await notes();
    for (const k of ["ArrowDown", "ArrowUp", "Home", "End"]) {
      key("A.md", k);
    }
    expect(document.activeElement).toBe(c.tree.treeRows.get("Z.txt"));
    key("Folder", "ArrowUp");
    expect(document.activeElement).toBe(c.tree.treeRows.get("Empty"));
    key("Z.txt", "ArrowDown");
    expect(document.activeElement).toBe(c.tree.treeRows.get("Z.txt"));
    key("Folder", "ArrowRight");
    expect(c.tree.expanded.has("Folder")).toBe(true);
    key("Folder", "ArrowRight");
    expect(document.activeElement).toBe(c.tree.treeRows.get("Folder/B.md"));
    key("Folder/B.md", "ArrowLeft");
    expect(document.activeElement).toBe(c.tree.treeRows.get("Folder"));
    key("Folder", "ArrowLeft");
    expect(c.tree.expanded.has("Folder")).toBe(false);
    key("A.md", "ArrowRight");
    key("A.md", "ArrowLeft");
    key("A.md", "other");
  });
  it("ignores file action shortcuts when the node no longer has a path", async () => {
    await notes();
    const row = c.tree.treeRows.get("A.md");
    const shortcut = event(row, { key: "F2" });
    c.tree.navigateTree(shortcut, { kind: "file" });
    expect(c.tree.actionDialogTarget.open).toBe(false);
    expect(shortcut.preventDefault).not.toHaveBeenCalled();
  });
  it("opens files, expands folders and launches rename/delete from keyboard", async () => {
    await notes();
    const opened = vi.spyOn(c, "openNode").mockResolvedValue();
    key("A.md", "Enter");
    expect(opened).toHaveBeenCalledWith("A.md");
    key("Folder", " ");
    expect(c.tree.expanded.has("Folder")).toBe(true);
    key("A.md", "F2");
    expect(c.tree.actionDialogTarget.open).toBe(true);
    c.tree.cancelAction();
    key("A.md", "Delete");
    expect(c.tree.actionInputTarget.hidden).toBe(true);
    key("A.md", "Enter", c.tree.treeRows.get("A.md").querySelector("button"));
  });
  it("handles tree clicks, row menus and focus events", async () => {
    await notes();
    c.tree.treeRows.get("Folder").click();
    expect(c.tree.expanded.has("Folder")).toBe(true);
    const open = vi.spyOn(c, "openNode").mockResolvedValue();
    c.tree.treeRows.get("A.md").click();
    expect(open).toHaveBeenCalledWith("A.md");
    c.tree.treeRows.get("A.md").querySelector("button").click();
    expect(c.tree.contextPath).toBe("A.md");
    drag(c.tree.treeRows.get("Z.txt"), "contextmenu");
    expect(c.tree.contextPath).toBe("Z.txt");
    c.tree.treeRows.get("A.md").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(c.tree.focusedPath).toBe("Empty");
    c.tree.showContextMenu(
      { currentTarget: c.tree.treeRows.get("A.md"), clientX: 100, clientY: 100 },
      "A.md",
    );
    expect(c.tree.contextMenuTarget.hidden).toBe(false);
  });
  it("handles draggable rows, busy operations and drops on folders or files", async () => {
    await notes();
    const move = vi.spyOn(c, "moveNode").mockResolvedValue();
    const row = c.tree.treeRows.get("A.md");
    drag(row, "dragstart");
    expect(c.tree.dragPath).toBe("A.md");
    const folder = c.tree.treeRows.get("Folder");
    drag(folder, "dragover");
    expect(folder.classList.contains("drop-target")).toBe(true);
    drag(folder, "dragleave");
    drag(folder, "drop");
    expect(move).toHaveBeenCalledWith("A.md", "Folder");
    drag(folder, "drop");
    drag(row, "dragend");
    expect(c.tree.dragPath).toBeNull();
    c.project.operationBusy = true;
    expect(drag(row, "dragstart").defaultPrevented).toBe(true);
    drag(folder, "dragover");
    c.project.operationBusy = false;
    drag(folder, "dragover");
    drag(row, "dragstart");
    drag(c.tree.treeRows.get("Z.txt"), "drop");
    expect(move).toHaveBeenCalledWith("A.md", "");
  });
  it("handles root drops and ignores invalid or busy drag targets", async () => {
    await notes();
    const root = c.rootNameTarget;
    const row = c.tree.treeRows.get("A.md");
    const move = vi.spyOn(c, "moveNode").mockResolvedValue();
    c.tree.rootDragOver(event(root));
    c.tree.rootDrop(event(root));
    c.tree.dragPath = "A.md";
    c.tree.rootDragOver(event(row));
    c.tree.rootDrop(event(row));
    c.project.workspaceIsDirectory = false;
    c.tree.rootDragOver(event(root));
    c.tree.rootDrop(event(root));
    c.project.workspaceIsDirectory = true;
    c.project.operationBusy = true;
    c.tree.rootDragOver(event(root));
    c.project.operationBusy = false;
    const keyboardEvent = event(root);
    c.tree.rootDragOver(keyboardEvent);
    expect(root.classList.contains("root-drop-target")).toBe(true);
    c.tree.rootDragLeave(event(root, { relatedTarget: root }));
    expect(root.classList.contains("root-drop-target")).toBe(true);
    c.tree.rootDragLeave(event(root, { relatedTarget: null }));
    expect(root.classList.contains("root-drop-target")).toBe(false);
    c.tree.rootDrop(keyboardEvent);
    expect(move).toHaveBeenCalledWith("A.md", "");
  });
  it("supports uploaded single files without directory drop handlers", () => {
    c.project.workspaceIsDirectory = false;
    c.project.nodes.set("A.md", { kind: "file", name: "A.md", parentPath: "", handle: fileHandle("A.md") });
    c.tree.renderTree();
    c.tree.dragPath = "x";
    drag(c.tree.treeRows.get("A.md"), "drop");
    expect(c.tree.dragPath).toBe("x");
  });
});
describe("Search", () => {
  async function search(query = "needle") {
    c.search.searchDialogTarget.open = true;
    c.search.searchInputTarget.value = query;
    const version = ++c.search.searchVersion;
    await c.search.runSearch(version);
  }
  it("finds filenames and contents and ranks filename matches first", async () => {
    await notes();
    await search("a");
    expect(c.search.searchMatches[0].path).toBe("A.md");
    await search();
    expect(c.search.searchMatches.map((m) => m.path)).toEqual(["Folder/B.md", "Z.txt"]);
    expect(c.search.searchResultsTarget.querySelectorAll("mark").length).toBeGreaterThan(0);
  });
  it("searches live editor text, fallback edits and cached files", async () => {
    await notes();
    await c.openNode("A.md");
    c.editor.view.dispatch({ changes: { from: 0, to: 5, insert: "needle live" } });
    c.project.nodes.get("Z.txt").text = "needle fallback";
    await search();
    expect(c.search.searchMatches).toHaveLength(3);
    await search();
    expect(c.search.searchMatches).toHaveLength(3);
  });
  it("skips binary content, supports filename searches and reports unreadable files", async () => {
    await project(
      c,
      directory("N", [
        fileHandle("a.png", "needle", "image/png"),
        fileHandle("b.mp3", "needle", "audio/mpeg"),
        fileHandle("binary", "x\0needle"),
      ]),
    );
    c.project.nodes.set("gone", {
      kind: "file",
      name: "gone",
      parentPath: "",
      handle: {
        getFile: async () => {
          throw new Error("gone");
        },
      },
    });
    await search();
    expect(c.search.searchMatches).toHaveLength(0);
    expect(c.search.searchInfoTarget.textContent).toContain("не удалось прочитать: 1");
    await search("a.png");
    expect(c.search.searchMatches[0].path).toBe("a.png");
  });
  it("handles empty queries, empty projects and no results", async () => {
    await search("");
    expect(c.search.searchResultsTarget.textContent).toContain("Откройте проект");
    await search("none");
    expect(c.search.searchResultsTarget.textContent).toContain("Ничего не найдено");
    await notes();
    await search("");
    expect(c.search.searchMatches).toHaveLength(3);
  });
  it("limits results to 100 and sorts equivalent matches", async () => {
    const entries = Array.from({ length: 105 }, (_, index) => fileHandle(`note${index}.md`, ""));
    await project(c, directory("N", entries));
    await search("note");
    expect(c.search.searchMatches).toHaveLength(100);
    expect(c.search.searchInfoTarget.textContent).toContain("первые 100");
  });
  it("respects root and nested gitignore rules, including negations", async () => {
    await project(
      c,
      directory("N", [
        fileHandle(".gitignore", "ignored/\n*.log\n!keep.log\n"),
        fileHandle("drop.log", "needle"),
        fileHandle("keep.log", "needle"),
        directory(".git", [fileHandle("data", "needle")]),
        directory("ignored", [fileHandle(".gitignore", "!N.md"), fileHandle("N.md", "needle")]),
        directory("Folder", [fileHandle(".gitignore", "B.md\n!B.md\n"), fileHandle("B.md", "needle")]),
        directory("Other", [fileHandle(".gitignore", "none"), fileHandle("C.md", "needle")]),
      ]),
    );
    await search();
    expect(c.search.searchMatches.map((m) => m.path)).toEqual(["Folder/B.md", "keep.log", "Other/C.md"]);
    const excluded = await c.search.searchExclusions(c.search.searchVersion);
    expect(excluded("")).toBe(false);
    expect(excluded("Folder/", "directory")).toBe(false);
    expect(excluded(".git/config")).toBe(true);
  });
  it("uses edited gitignore contents and uploaded ignore files", async () => {
    await project(c, directory("N", [fileHandle(".gitignore", "B.md"), fileHandle("A.md", "needle")]));
    await c.openNode(".gitignore");
    c.editor.view.dispatch({ changes: { from: 0, to: 4, insert: "B.md" } });
    await search();
    expect(c.search.searchMatches.some((m) => m.path === "A.md")).toBe(true);
    c.editor.closeEditor();
    c.project.nodes.get(".gitignore").text = "A.md";
    await search();
    expect(c.search.searchMatches.some((m) => m.path === "A.md")).toBe(false);
  });
  it("fails closed if ignore loading fails and permits a retry", async () => {
    await project(c, directory("N", [fileHandle(".gitignore", "A.md")]));
    c.project.ignoreFactoryPromise = null;
    c.project.invalidateExclusions();
    vi.spyOn(c.project, "loadIgnore").mockRejectedValue(new Error("loader"));
    await search();
    expect(c.search.searchInfoTarget.textContent).toContain("Поиск остановлен");
    expect(c.project.ignoreFactoryPromise).toBeNull();
    c.project.loadIgnore.mockRestore();
    await search();
    expect(c.project.ignoreFactoryPromise).toBeTruthy();
  });
  it("ignores obsolete queries before, during and after reading", async () => {
    await notes();
    c.search.searchDialogTarget.open = true;
    c.search.searchInputTarget.value = "needle";
    await c.search.runSearch(++c.search.searchVersion - 1);
    c.search.searchDialogTarget.open = false;
    await c.search.runSearch(c.search.searchVersion);
    c.search.searchDialogTarget.open = true;
    const original = c.search.searchExclusions.bind(c);
    vi.spyOn(c.search, "searchExclusions").mockResolvedValue(null);
    await c.search.runSearch(c.search.searchVersion);
    c.search.searchExclusions.mockImplementation(async () => {
      c.search.searchVersion++;
      return () => false;
    });
    await c.search.runSearch(c.search.searchVersion);
    c.search.searchExclusions.mockImplementation(async () => () => {
      c.search.searchVersion++;
      return false;
    });
    await c.search.runSearch(c.search.searchVersion);
    c.search.searchExclusions.mockImplementation(original);
    expect(c.search.searchResultsTarget.children).toHaveLength(0);
  });
  it("discards stale ignore file reads and suppresses stale loading errors", async () => {
    await project(c, directory("N", [fileHandle(".gitignore", "A.md")]));
    c.search.searchDialogTarget.open = false;
    expect(await c.search.searchExclusions(c.search.searchVersion)).toBeNull();
    c.search.searchDialogTarget.open = true;
    expect(await c.search.searchExclusions(c.search.searchVersion - 1)).toBeNull();
    vi.spyOn(c.search, "searchExclusions").mockImplementation(async () => {
      c.search.searchVersion++;
      throw new Error("late");
    });
    await c.search.runSearch(c.search.searchVersion);
    expect(c.search.searchInfoTarget.textContent).not.toContain("Поиск остановлен");
  });
  it("opens and closes search and blocks duplicate or conflicting dialogs", () => {
    c.search.openSearch();
    expect(c.search.searchDialogTarget.open).toBe(true);
    c.search.openSearch();
    c.search.closeSearch();
    c.tree.actionDialogTarget.open = true;
    c.search.openSearch();
    expect(c.search.searchDialogTarget.open).toBe(false);
  });
  it("supports keyboard result selection and opens the matching text offset", async () => {
    await notes();
    await search();
    c.search.searchKey(event(c.search.searchInputTarget, { key: "ArrowDown" }));
    expect(c.search.searchIndex).toBe(1);
    c.search.searchKey(event(c.search.searchInputTarget, { key: "ArrowUp" }));
    expect(c.search.searchIndex).toBe(0);
    c.search.searchKey(event(c.search.searchInputTarget, { key: "other" }));
    await c.search.openSearchMatch(0);
    expect(c.project.currentPath).toBe("Folder/B.md");
    expect(c.editor.view.state.selection.main.anchor).toBe(0);
    await c.search.openSearchMatch(99);
    c.search.searchMatches = [];
    c.search.searchKey(event(c.search.searchInputTarget, { key: "ArrowDown" }));
  });
  it("handles filename-only matches and failed opening", async () => {
    await notes();
    await search("A.md");
    await c.search.openSearchMatch(0);
    expect(c.project.currentPath).toBe("A.md");
    c.search.searchMatches = [{ path: "missing", offset: 10 }];
    await c.search.openSearchMatch(0);
    expect(c.project.currentPath).toBe("A.md");
  });
  it("opens results by click and Enter", async () => {
    await notes();
    await search();
    const opened = vi.spyOn(c.search, "openSearchMatch").mockResolvedValue();
    c.search.searchResultsTarget.querySelector("button").click();
    expect(opened).toHaveBeenCalledWith(0);
    c.search.searchKey(event(c.search.searchInputTarget, { key: "Enter" }));
    expect(opened).toHaveBeenCalledWith(0);
  });
});
