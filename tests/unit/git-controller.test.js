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
  expect(git.repositoryTarget.textContent).toBe("notes · main");
  expect(git.changesTarget.querySelectorAll("button")).toHaveLength(4);
  expect(git.changesTarget.textContent).toContain("old.md → renamed.md");
  expect(git.commitsTarget.textContent).toContain("<script>");
  expect(git.commitsTarget.querySelector("script")).toBeNull();
  git.close();
  expect(git.dialogTarget.open).toBe(false);
  expect(stop).toHaveBeenCalled();
});

it("selects both file comparisons, commit diffs and the next history page", async () => {
  const git = await controller();
  workspace.project.dirHandle = folder();
  await git.refresh();
  request.mockResolvedValue({ patch: "@@ -1 +1 @@\n-before\n+after\n <img>" });
  await git.selectChange({ currentTarget: { dataset: { path: "note.md", area: "staged" } } });
  expect(git.headingTarget.textContent).toContain("HEAD → индекс");
  expect(git.patchTarget.querySelector(".git-added").textContent).toBe("+after\n");
  await git.selectChange({ currentTarget: { dataset: { path: "note.md", area: "working" } } });
  expect(git.headingTarget.textContent).toContain("рабочая папка");
  await git.selectCommit({ currentTarget: { dataset: { oid: COMMIT.oid } } });
  expect(git.headingTarget.textContent).toContain(COMMIT.oid.slice(0, 8));
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
  git.renderRepository({ ...SNAPSHOT, changes: null });
  expect(git.changesTarget.textContent).not.toContain("чистая");
  git.renderPatch({ patch: "line\n".repeat(5001) });
  expect(git.patchTarget.textContent).toContain("Показаны первые 5000");
  git.renderPatch({});
  expect(git.patchTarget.textContent).toContain("Нет различий");
});

it("removes obsolete helper credentials without opening a connection", async () => {
  sessionStorage.setItem("open-notes-git", "old-secret");
  history.replaceState(null, "", "/edit.html#git=old-secret&other=keep");
  const git = await controller();
  expect(sessionStorage.getItem("open-notes-git")).toBeNull();
  expect(location.hash).toBe("#other=keep");
  expect(git.dialogTarget.open).toBe(false);
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
  git.dialogTarget.showModal();
  await git.projectChanged();
  expect(git.contentTarget.hidden).toBe(false);
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
