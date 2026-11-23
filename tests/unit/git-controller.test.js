import { afterEach, expect, it, vi } from "vitest";

import { directory, fileHandle, mount } from "../support/workspace.js";

const { request, stop } = vi.hoisted(() => ({ request: vi.fn(), stop: vi.fn() }));
vi.mock("../../src/js/git.js", () => ({
  GitReader: class {
    request = request;
    stop = stop;
  },
}));

const COMMIT = {
  oid: "1".repeat(40),
  author: "Author",
  date: "2026-11-23T10:00:00Z",
  subject: "Initial <script> literal",
};
const SNAPSHOT = {
  root: "notes",
  branch: "main",
  more: true,
  commits: [COMMIT],
  changes: [
    { path: "note.md", staged: "M", working: "M" },
    { path: "new.md", staged: "?", working: " " },
    { path: "renamed.md", staged: "R", working: " ", oldPath: "old.md" },
  ],
};
let app;
let workspace;

function folder() {
  return directory("notes", [directory(".git", [fileHandle("HEAD", "ref: refs/heads/main\n")])]);
}

async function controller() {
  const mounted = await mount();
  app = mounted.app;
  workspace = mounted.c;
  request.mockResolvedValue(SNAPSHOT);
  return app.getControllerForElementAndIdentifier(document.querySelector(".app"), "git");
}

afterEach(() => {
  app?.stop();
  sessionStorage.clear();
  history.replaceState(null, "", "/edit.html");
});

it("opens the current folder, renders literal data and closes without touching the document", async () => {
  const git = await controller();
  git.open();
  await vi.waitFor(() => expect(git.statusTarget.textContent).toContain("Откройте папку"));
  workspace.project.dirHandle = folder();
  await git.refresh();
  expect(git.launchTarget.textContent).toBe("Git · main");
  expect(git.repositoryTarget.textContent).toBe("notes");
  expect(git.branchTarget.textContent).toBe("main");
  expect(git.changesTarget.querySelectorAll("button")).toHaveLength(4);
  expect(git.changesTarget.textContent).toContain("renamed.md");
  expect(git.commitsTarget.textContent).toContain("<script>");
  expect(git.commitsTarget.querySelector("script")).toBeNull();
  git.close();
  expect(git.panelTarget.hidden).toBe(true);
  expect(stop).toHaveBeenCalled();
});

it("selects both file comparisons, commit diffs and the next history page", async () => {
  const git = await controller();
  workspace.project.dirHandle = folder();
  await git.refresh();
  request.mockImplementation(async (operation) =>
    operation === "commit"
      ? { files: ["note.md"] }
      : { path: "note.md", before: "before\n <img>", after: "after\n <img>" },
  );
  await git.selectChange({ currentTarget: { dataset: { path: "note.md", area: "staged" } } });
  expect(git.beforeLabelTarget.textContent).toContain("HEAD");
  expect(git.afterLabelTarget.textContent).toContain("staged");
  expect(git.patchTarget.textContent).toContain("after");
  await git.selectChange({ currentTarget: { dataset: { path: "note.md", area: "working" } } });
  expect(git.afterLabelTarget.textContent).toBe("Рабочая копия");
  await git.selectCommit({ currentTarget: { dataset: { oid: COMMIT.oid } } });
  expect(git.afterLabelTarget.textContent).toContain(COMMIT.oid.slice(0, 8));
  expect(git.patchTarget.querySelector("img")).toBeNull();
  request.mockResolvedValue({ commits: [], more: false });
  await git.older();
  expect(request).toHaveBeenLastCalledWith("history", 1);
});

it("distinguishes clean, unborn and unreadable changes and bounds diff rendering", async () => {
  const git = await controller();
  git.renderRepository({ ...SNAPSHOT, changes: [], commits: [], more: false });
  expect(git.changesTarget.textContent).toContain("чистая");
  expect(git.commitsTarget.textContent).toContain("нет коммитов");
  git.filePath = "new.md";
  git.commitsTarget.replaceChildren();
  git.renderHistory({ commits: [], more: false });
  expect(git.commitsTarget.textContent).toContain("У этого файла");
  git.filePath = null;
  git.renderRepository({ ...SNAPSHOT, changes: null });
  expect(git.changesTarget.textContent).not.toContain("чистая");
  git.renderPatch({ patch: "Двоичный файл" });
  expect(git.patchTarget.textContent).toContain("Двоичный файл");
  git.renderPatch({});
  expect(git.patchTarget.textContent).toContain("Нет различий");
});

it("removes obsolete helper credentials without opening a connection", async () => {
  sessionStorage.setItem("open-notes-git", "old-secret");
  history.replaceState(null, "", "/edit.html#git=old-secret&other=keep");
  const git = await controller();
  expect(sessionStorage.getItem("open-notes-git")).toBeNull();
  expect(location.hash).toBe("#other=keep");
  expect(git.panelTarget.hidden).toBe(true);
  const storage = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("disabled");
  });
  git.connect();
  storage.mockRestore();
});

it("updates the branch on folder changes and clears data from the previous repository", async () => {
  const git = await controller();
  workspace.project.dirHandle = folder();
  await git.projectChanged();
  expect(git.launchTarget.textContent).toBe("Git · main");
  git.openPanel();
  await git.projectChanged();
  expect(git.panelTarget.hidden).toBe(true);
  workspace.project.dirHandle = null;
  await git.projectChanged();
  expect(git.launchTarget.textContent).toBe("Git");
  expect(git.contentTarget.hidden).toBe(true);
});

it("handles a worktree grant and picker cancel/errors", async () => {
  const git = await controller();
  workspace.project.dirHandle = directory("linked", [
    fileHandle(".git", "gitdir: /main/.git/worktrees/linked"),
  ]);
  await git.refresh();
  expect(git.mainFolderTarget.hidden).toBe(false);
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockRejectedValue(new DOMException("canceled", "AbortError")));
  await git.chooseMain();
  expect(git.statusTarget.textContent).toContain("worktree");
  showDirectoryPicker.mockRejectedValue(new Error("denied"));
  await git.chooseMain();
  expect(git.statusTarget.textContent).toBe("denied");
  showDirectoryPicker.mockResolvedValue(folder());
  workspace.project.dirHandle = folder();
  await git.chooseMain();
  expect(git.contentTarget.hidden).toBe(false);
});

it("discards obsolete requests, errors and initialization after closing", async () => {
  const git = await controller();
  workspace.project.dirHandle = folder();
  await git.refresh();
  let finish;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = git.load(["repository"], () => {
    throw new Error("stale");
  });
  git.disconnect();
  finish(SNAPSHOT);
  await pending;
  let fail;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        fail = reject;
      }),
  );
  git.reader = { request, stop };
  const failed = git.load(["repository"], vi.fn());
  git.disconnect();
  fail(new Error("old"));
  await failed;
  expect(git.statusTarget.textContent).not.toBe("old");
});

it("reports current processing errors and warnings", async () => {
  const git = await controller();
  workspace.project.dirHandle = folder();
  await git.refresh();
  request.mockRejectedValue(new Error("broken index"));
  await git.load(["repository"], vi.fn());
  expect(git.statusTarget.textContent).toBe("broken index");
  await git.refresh();
  expect(git.statusTarget.textContent).toBe("broken index");
  request.mockResolvedValue({ ...SNAPSHOT, warning: "partial" });
  await git.refresh();
  expect(git.statusTarget.textContent).toBe("partial");
});

it("ignores branch reads and folder resolution after switching projects", async () => {
  const git = await controller();
  const root = folder();
  workspace.project.dirHandle = root;
  let finishHead;
  const head = root.children.get(".git").children.get("HEAD");
  const original = await head.getFile();
  const read = vi.spyOn(head, "getFile").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishHead = resolve;
      }),
  );
  const branch = git.projectChanged();
  await vi.waitFor(() => expect(read).toHaveBeenCalled());
  git.disconnect();
  finishHead(original);
  await branch;
  expect(git.launchTarget.textContent).toBe("Git");
  let finishFolder;
  const get = vi.spyOn(root, "getDirectoryHandle").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFolder = resolve;
      }),
  );
  const pending = git.refresh();
  git.disconnect();
  finishFolder(root.children.get(".git"));
  await pending;
  expect(git.contentTarget.hidden).toBe(true);
  get.mockRestore();
});

it("ignores a canceled worker initialization and its delayed failure", async () => {
  const git = await controller();
  workspace.project.dirHandle = folder();
  let finish;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = git.refresh();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  git.disconnect();
  finish({});
  await pending;
  expect(git.contentTarget.hidden).toBe(true);
  let fail;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        fail = reject;
      }),
  );
  const failed = git.refresh();
  await vi.waitFor(() => expect(fail).toBeTypeOf("function"));
  git.disconnect();
  fail(new Error("obsolete"));
  await failed;
  expect(git.statusTarget.textContent).not.toBe("obsolete");
  git.renderRepository({ ...SNAPSHOT, changes: [], warning: "Excluded links" });
  expect(git.changesTarget.textContent).toContain("доступных файлах");
});

it("opens history directly from the active file and compares its saved version", async () => {
  const git = await controller();
  workspace.project.dirHandle = folder();
  workspace.project.currentPath = "note.md";
  request.mockImplementation(async (operation) => {
    if (operation === "diff" || operation === "commitDiff") {
      return {
        path: "note.md",
        before: "before",
        after: "after",
      };
    }
    return SNAPSHOT;
  });
  git.openFileHistory();
  await vi.waitFor(() => expect(git.diffView).not.toBeNull());
  expect(git.changeSectionTarget.hidden).toBe(true);
  expect(git.fileHistoryTitleTarget.textContent).toBe("История · note.md");
  expect(request).toHaveBeenCalledWith("fileHistory", { path: "note.md", skip: 0 });
  await git.selectCommit({ currentTarget: { dataset: { oid: COMMIT.oid } } });
  expect(request).toHaveBeenLastCalledWith("commitDiff", { oid: COMMIT.oid, path: "note.md" });
  expect(git.patchTarget.querySelectorAll(".cm-editor")).toHaveLength(2);
  git.nextChange();
  git.previousChange();
  git.layoutTarget.value = "unified";
  git.toggleLayout();
  expect(git.patchTarget.querySelectorAll(".cm-editor")).toHaveLength(1);
  expect(git.versionsTarget.hidden).toBe(false);
  git.layoutTarget.value = "split";
  git.toggleLayout();
  expect(git.patchTarget.querySelectorAll(".cm-editor")).toHaveLength(2);
  request.mockResolvedValue({ commits: [], more: false });
  await git.older();
  expect(request).toHaveBeenLastCalledWith("fileHistory", { path: "note.md", skip: 1 });
  git.close();
  git.nextChange();
  git.previousChange();
});

it("handles empty commit file lists and closing while scoped history is loading", async () => {
  const git = await controller();
  git.renderCommit({ files: [] });
  expect(git.commitFilesTarget.hidden).toBe(true);
  workspace.project.dirHandle = folder();
  await git.refresh();
  git.filePath = "note.md";
  git.openPanel();
  let finish;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = git.loadFileHistory();
  git.close();
  finish({ commits: [], more: false });
  await pending;
  expect(git.diffView).toBeNull();
});

it("handles F7 throughout the dialog without double-handling editor shortcuts", async () => {
  const git = await controller();
  const event = { key: "F7", defaultPrevented: false, shiftKey: false, preventDefault: vi.fn() };
  git.diffKeydown(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  git.diffView = { navigate: vi.fn(), destroy: vi.fn() };
  git.diffKeydown({ ...event, key: "Escape" });
  git.diffKeydown({ ...event, defaultPrevented: true });
  expect(git.diffView.navigate).not.toHaveBeenCalled();
  git.diffKeydown(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(git.diffView.navigate).toHaveBeenLastCalledWith(false);
  git.diffKeydown({ ...event, shiftKey: true });
  expect(git.diffView.navigate).toHaveBeenLastCalledWith(true);
});

it("separates changes from history and keeps the displayed file selected after focus moves", async () => {
  const git = await controller();
  workspace.project.dirHandle = folder();
  await git.refresh();
  request.mockImplementation(async (operation) =>
    operation === "commit" ? { files: ["note.md"] } : { path: "note.md", before: "before", after: "after" },
  );
  const first = git.changesTarget.querySelector("button");
  first.click();
  await vi.waitFor(() => expect(git.diffView).not.toBeNull());
  git.nextChange();
  expect(first.getAttribute("aria-current")).toBe("true");
  const key = (keyValue) => new KeyboardEvent("keydown", { key: keyValue, bubbles: true, cancelable: true });
  first.dispatchEvent(key("ArrowDown"));
  expect(git.changesTarget.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
  git.changesTabTarget.dispatchEvent(key("ArrowRight"));
  expect(git.historyTabTarget.getAttribute("aria-selected")).toBe("true");
  expect(git.changeSectionTarget.hidden).toBe(true);
  expect(git.historySectionTarget.hidden).toBe(false);
  git.historyTabTarget.dispatchEvent(key("ArrowLeft"));
  expect(git.changesTabTarget.getAttribute("aria-selected")).toBe("true");
  const unrelated = key("Enter");
  git.changesTabTarget.dispatchEvent(unrelated);
  expect(unrelated.defaultPrevented).toBe(false);
  git.renderCommit({ files: ["note.md", "other.md"] });
  const second = git.commitFileListTarget.querySelectorAll("button")[1];
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  second.click();
  await vi.waitFor(() => expect(git.headingTarget.textContent).toBe("other.md"));
  expect(second.getAttribute("aria-current")).toBe("true");
});

it("keeps version labels visible and adapts to narrow screens until a layout is explicitly chosen", async () => {
  const git = await controller();
  git.resizeDiff();
  workspace.project.dirHandle = folder();
  await git.refresh();
  git.renderPatch({ path: "note.md", before: "before", after: "after" });
  expect(git.counterTarget.textContent).toBe("1 / 1");
  vi.stubGlobal("innerWidth", 390);
  git.resizeDiff();
  expect(git.patchTarget.querySelectorAll(".cm-editor")).toHaveLength(1);
  expect(git.versionsTarget.hidden).toBe(false);
  git.resizeDiff();
  vi.stubGlobal("innerWidth", 1280);
  git.resizeDiff();
  expect(git.patchTarget.querySelectorAll(".cm-editor")).toHaveLength(2);
  git.layoutTarget.value = "unified";
  git.toggleLayout();
  git.resizeDiff();
  expect(git.patchTarget.querySelectorAll(".cm-editor")).toHaveLength(1);
  git.toggleWrapping();
  expect(git.wrappingTarget.getAttribute("aria-pressed")).toBe("false");
  git.toggleWrapping();
  expect(git.wrappingTarget.getAttribute("aria-pressed")).toBe("true");
  git.renderPatch({ path: "clean.md", before: "same", after: "same" });
  expect(git.counterTarget.textContent).toBe("Нет изменений");
  expect(git.previousTarget.disabled).toBe(true);
  expect(git.nextTarget.disabled).toBe(true);
  vi.stubGlobal("innerWidth", 1024);
});

it("chooses inline comparison by default on a narrow viewport", async () => {
  vi.stubGlobal("innerWidth", 390);
  const git = await controller();
  expect(git.isUnified).toBe(true);
  vi.stubGlobal("innerWidth", 1024);
});

it("opens the current file automatically and falls back to staged files in a staged-only list", async () => {
  const git = await controller();
  workspace.project.dirHandle = folder();
  workspace.project.currentPath = "note.md";
  request.mockImplementation(async (operation) =>
    operation === "diff" ? { path: "note.md", before: "before", after: "after" } : SNAPSHOT,
  );
  git.open();
  await vi.waitFor(() => expect(git.diffView).not.toBeNull());
  expect(git.changesTarget.querySelector('[aria-current="true"]').dataset.path).toBe("note.md");
  expect(git.changesTarget.querySelector('[aria-current="true"]').dataset.area).toBe("working");
  git.renderRepository({ ...SNAPSHOT, changes: [{ path: "added.md", staged: "A", working: " " }] });
  await vi.waitFor(() => expect(git.headingTarget.textContent).toBe("added.md"));
  git.renderRepository({ ...SNAPSHOT, changes: [] });
  expect(git.diffView).toBeNull();
});

it("restores the selected historical comparison and handles an empty repository history", async () => {
  const git = await controller();
  workspace.project.dirHandle = folder();
  request.mockImplementation(async (operation) => {
    if (operation === "commit") {
      return { files: ["note.md"] };
    }
    if (operation === "commitDiff") {
      return {
        path: "note.md",
        before: "old",
        after: "committed",
      };
    }
    return SNAPSHOT;
  });
  git.mode = "history";
  git.openPanel();
  await git.refresh();
  await vi.waitFor(() => expect(git.diffView).not.toBeNull());
  expect(git.afterLabelTarget.textContent).toContain("Коммит");
  git.commitsTarget.replaceChildren();
  git.selectHistory();
  expect(git.patchTarget.textContent).toContain("пока нет коммитов");
});

it("restores the working version when returning to a file's history", async () => {
  const git = await controller();
  workspace.project.dirHandle = folder();
  workspace.project.currentPath = "note.md";
  request.mockImplementation(async (operation) =>
    operation === "diff" ? { path: "note.md", before: "before", after: "working" } : SNAPSHOT,
  );
  git.openFileHistory();
  await vi.waitFor(() => expect(git.diffView).not.toBeNull());
  git.changesTabTarget.click();
  await vi.waitFor(() => expect(git.beforeLabelTarget.textContent).toContain("HEAD"));
  git.historyTabTarget.click();
  await vi.waitFor(() => expect(git.beforeLabelTarget.textContent).toContain("HEAD"));
  expect(git.workingVersionTarget.getAttribute("aria-current")).toBe("true");
});

it("keeps file and diff tabs independent and updates the comparison from an unsaved draft", async () => {
  const git = await controller();
  workspace.project.dirHandle = folder();
  workspace.project.currentPath = "notes/note.md";
  git.fileChanged();
  expect(git.fileTabTarget.textContent).toBe("note.md");
  const draft = vi.spyOn(workspace.editor, "textFor").mockReturnValue("unsaved");
  request.mockImplementation(async (operation, selection) =>
    operation === "diff" ? { path: selection.path, before: "before", after: selection.draft } : SNAPSHOT,
  );
  git.openFileChanges();
  await vi.waitFor(() => expect(git.diffView).not.toBeNull());
  expect(git.filePaneTarget.hidden).toBe(true);
  expect(git.tabBarTarget.hidden).toBe(false);
  expect(git.diffTabTarget.textContent).toBe("note.md · изменения");
  expect(git.diffTabTarget.title).toBe("notes/note.md");
  expect(git.patchTarget.textContent).toContain("unsaved");
  git.fileActionsTarget.click();
  await vi.waitFor(() => expect(git.commitsTarget.textContent).toContain("Initial"));
  expect(git.navigationTarget.hidden).toBe(false);
  git.changesTabTarget.click();
  await vi.waitFor(() => expect(git.navigationTarget.hidden).toBe(true));
  const firstView = git.diffView;
  git.activateFile();
  expect(git.panelTarget.hidden).toBe(true);
  expect(git.diffView).toBe(firstView);
  git.activateDiff();
  await vi.waitFor(() => expect(git.patchTarget.getAttribute("aria-busy")).toBe("false"));
  expect(git.diffView).toBe(firstView);
  draft.mockReturnValue("edited draft");
  const position = firstView.snapshot();
  const restore = vi.spyOn(git, "renderPatch");
  git.activateFile();
  git.activateDiff();
  await vi.waitFor(() => expect(restore).toHaveBeenCalled());
  expect(git.patchTarget.textContent).toContain("edited draft");
  expect(git.diffView.snapshot().anchor).toBe(position.anchor);
  git.fileTabTarget.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  expect(git.diffTabTarget.getAttribute("aria-selected")).toBe("true");
  git.diffTabTarget.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  expect(git.fileTabTarget.getAttribute("aria-selected")).toBe("true");
  git.editorTabKey({ key: "Enter" });
  workspace.project.currentPath = null;
  git.fileChanged();
  expect(git.fileTabTarget.textContent).toBe("Файл");
  git.close();
  expect(git.tabBarTarget.hidden).toBe(true);
  git.activateDiff();
  expect(git.diffView).toBeNull();
});
