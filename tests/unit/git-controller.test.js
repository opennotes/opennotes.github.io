import { afterEach, expect, it, vi } from "vitest";

import { mount } from "../support/workspace.js";

const LINK = `http://127.0.0.1:34567/#${"a".repeat(64)}`;
const COMMIT = {
  oid: "1".repeat(40),
  author: "Author",
  date: "2026-11-23T10:00:00Z",
  subject: "Initial <script> literal",
};
const SNAPSHOT = {
  root: "/work/notes",
  branch: "main",
  more: true,
  commits: [COMMIT],
  changes: [
    { path: "note.md", staged: "M", working: "M", oldPath: "" },
    { path: "new.md", staged: "?", working: "?", oldPath: "" },
    { path: "renamed.md", staged: "R", working: " ", oldPath: "old.md" },
  ],
};
let app;

afterEach(() => {
  app?.stop();
  sessionStorage.clear();
  history.replaceState(null, "", "/edit.html");
});

async function controller() {
  const mounted = await mount();
  app = mounted.app;
  return app.getControllerForElementAndIdentifier(document.querySelector(".app"), "git");
}

function response(data) {
  return {
    ok: true,
    json: async () => data,
  };
}

it("opens without a helper and reports a malformed connection without a network call", async () => {
  const git = await controller();
  git.open();
  expect(git.dialogTarget.open).toBe(true);
  git.connectionTarget.value = "wrong";
  await git.connectGit();
  expect(git.statusTarget.textContent).toContain("Вставьте адрес");
  git.close();
  expect(git.dialogTarget.open).toBe(false);
});

it("renders staged and unstaged groups, renamed paths and literal commit subjects", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(SNAPSHOT));
  const git = await controller();
  git.connectionTarget.value = LINK;
  const event = { preventDefault: vi.fn() };
  await git.connectGit(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(git.launchTarget.textContent).toBe("Git · main");
  expect(git.repositoryTarget.textContent).toBe("/work/notes · main");
  expect(git.changesTarget.querySelectorAll("button")).toHaveLength(4);
  expect(git.changesTarget.textContent).toContain("old.md → renamed.md");
  expect(git.commitsTarget.textContent).toContain("<script>");
  expect(git.commitsTarget.querySelector("script")).toBeNull();
  git.open();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  git.forget();
  expect(git.formTarget.hidden).toBe(false);
  expect(git.moreTarget.hidden).toBe(true);
  expect(git.launchTarget.textContent).toBe("Git");
});

it("reads file and commit diffs and fetches the next history page", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(SNAPSHOT));
  const git = await controller();
  git.connectionTarget.value = LINK;
  await git.connectGit();
  fetch.mockResolvedValue(response({ patch: "@@ -1 +1 @@\n-before\n+after\n <img>" }));
  await git.selectChange({ currentTarget: { dataset: { path: "note.md", area: "staged" } } });
  expect(git.headingTarget.textContent).toContain("HEAD → индекс");
  expect(git.patchTarget.querySelector(".git-added").textContent).toBe("+after\n");
  await git.selectChange({ currentTarget: { dataset: { path: "note.md", area: "working" } } });
  expect(git.headingTarget.textContent).toContain("рабочая папка");
  await git.selectCommit({ currentTarget: { dataset: { oid: COMMIT.oid } } });
  expect(git.headingTarget.textContent).toContain(COMMIT.oid.slice(0, 8));
  expect(git.patchTarget.querySelector("img")).toBeNull();
  fetch.mockResolvedValue(response({ commits: [], more: false }));
  await git.older();
  expect(fetch.mock.calls.at(-1)[0].search).toBe("?skip=1");
  expect(git.moreTarget.hidden).toBe(true);
});

it("handles clean and unborn repositories and bounds a large patch", async () => {
  const git = await controller();
  git.connectionTarget.value = LINK;
  git.renderRepository({ ...SNAPSHOT, changes: [], commits: [], more: false });
  expect(git.changesTarget.textContent).toContain("чистая");
  expect(git.commitsTarget.textContent).toContain("нет коммитов");
  git.renderPatch({ patch: "line\n".repeat(5001) });
  expect(git.patchTarget.textContent).toContain("Показаны первые 5000");
  git.renderPatch({ patch: "" });
  expect(git.patchTarget.textContent).toContain("Нет различий");
});

it("discards slow results after closing or selecting something newer", async () => {
  let finish;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const git = await controller();
  git.connectionTarget.value = LINK;
  const pending = git.connectGit();
  git.close();
  finish(response(SNAPSHOT));
  await pending;
  expect(git.controlsTarget.hidden).toBe(true);
  fetch.mockRejectedValueOnce(new Error("offline"));
  await git.refresh();
  expect(git.statusTarget.textContent).toContain("Нет связи");
});

it("does not surface errors from an obsolete request", async () => {
  let failRequest;
  vi.spyOn(globalThis, "fetch").mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        failRequest = reject;
      }),
  );
  const git = await controller();
  git.connectionTarget.value = LINK;
  const pending = git.connectGit();
  git.forget();
  failRequest(new Error("aborted"));
  await pending;
  expect(git.statusTarget.textContent).toBe("Git отключён.");
});

it("connects a helper link from the terminal and removes its fragment", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response(SNAPSHOT));
  history.replaceState(null, "", `/edit.html#git=${encodeURIComponent(LINK)}`);
  const git = await controller();
  await vi.waitFor(() => expect(git.launchTarget.textContent).toBe("Git · main"));
  expect(git.dialogTarget.open).toBe(true);
  expect(location.hash).toBe("");
});

it("does not reuse canceled request versions after a controller reconnects", async () => {
  let finish;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const git = await controller();
  git.connectionTarget.value = LINK;
  const pending = git.connectGit();
  git.disconnect();
  git.connect();
  fetch.mockResolvedValue(response({ ...SNAPSHOT, branch: "newer" }));
  await git.refresh();
  finish(response(SNAPSHOT));
  await pending;
  expect(git.launchTarget.textContent).toBe("Git · newer");
});
