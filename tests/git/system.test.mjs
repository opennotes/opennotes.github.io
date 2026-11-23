import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { diff, history, repoRoot, snapshot, startGitServer } from "../../src/public/open-notes-git.mjs";

const ORIGIN = "https://opennotes.github.io";

function git(root, args) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- Exercise system Git against disposable test repositories.
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function repo(t, shouldCommit = true) {
  const root = await mkdtemp(path.join(tmpdir(), "open-notes-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "Git test"]);
  git(root, ["config", "user.email", "git-test@example.test"]);
  if (shouldCommit) {
    await writeFile(path.join(root, "note.md"), "before\n");
    await writeFile(path.join(root, "deleted.md"), "gone\n");
    await writeFile(path.join(root, "rename.md"), "rename\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "Initial <script> literal"]);
  }
  return root;
}

test("system Git reports staged, unstaged, deleted, untracked and renamed files without writing the index", async (t) => {
  const root = await repo(t);
  await writeFile(path.join(root, "note.md"), "staged\n");
  git(root, ["add", "note.md"]);
  await writeFile(path.join(root, "note.md"), "working\n");
  await writeFile(path.join(root, "new file.md"), "fresh\n");
  await unlink(path.join(root, "deleted.md"));
  git(root, ["mv", "rename.md", "renamed.md"]);
  const index = await readFile(path.join(root, ".git/index"));
  const data = await snapshot(root);
  assert.equal(data.branch, "main");
  assert.equal(data.commits[0].subject, "Initial <script> literal");
  assert.equal(data.changes.find((file) => file.path === "note.md").staged, "M");
  assert.equal(data.changes.find((file) => file.path === "note.md").working, "M");
  assert.equal(data.changes.find((file) => file.path === "deleted.md").working, "D");
  assert.equal(data.changes.find((file) => file.path === "renamed.md").oldPath, "rename.md");
  for (const [area, filepath, removed, added] of [
    ["staged", "note.md", "before", "staged"],
    ["working", "note.md", "staged", "working"],
    ["working", "deleted.md", "gone", ""],
    ["untracked", "new file.md", "", "fresh"],
  ]) {
    // eslint-disable-next-line no-await-in-loop -- Check each comparison against its own expected patch.
    const { patch } = await diff(root, new URLSearchParams({ area, path: filepath }));
    if (removed) {
      assert.ok(patch.includes(`-${removed}\n`));
    }
    if (added) {
      assert.ok(patch.includes(`+${added}\n`));
    }
  }
  const commit = await diff(root, new URLSearchParams({ commit: data.commits[0].oid }));
  assert.ok(commit.patch.includes("+before\n"));
  assert.deepEqual(await readFile(path.join(root, ".git/index")), index);
});

test("empty repositories, detached HEAD and linked worktrees use native Git semantics", async (t) => {
  const empty = await repo(t, false);
  const emptySnapshot = await snapshot(empty);
  const emptyHistory = await history(empty);
  assert.equal(emptySnapshot.branch, "main");
  assert.deepEqual(emptyHistory.commits, []);
  const root = await repo(t);
  const worktree = `${root}-worktree`;
  t.after(() => rm(worktree, { recursive: true, force: true }));
  git(root, ["worktree", "add", "--detach", worktree, "HEAD"]);
  const data = await snapshot(worktree);
  assert.ok(data.branch.startsWith("detached HEAD"));
  assert.equal(await repoRoot(worktree), await realpath(worktree));
  assert.equal(data.commits.length, 1);
});

test("history is paged instead of loading every commit", async (t) => {
  const root = await repo(t);
  for (let index = 0; index < 30; index++) {
    git(root, ["commit", "--allow-empty", "-m", `Commit ${index}`]);
  }
  const first = await history(root);
  assert.equal(first.commits.length, 30);
  assert.equal(first.more, true);
  const last = await history(root, 30);
  assert.equal(last.commits.length, 1);
  assert.equal(last.more, false);
});

test("helper requires the session token, known Origin and loopback Host", async (t) => {
  const root = await repo(t);
  const { server, connection } = await startGitServer(root);
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const url = new URL(connection);
  const token = url.hash.slice(1);
  const headers = { Origin: ORIGIN, Authorization: `Bearer ${token}` };
  const request = async (route, overrides = {}) => {
    const response = await fetch(new URL(route, url), { headers, ...overrides });
    return response.status;
  };
  assert.equal(await request("/repository"), 200);
  assert.equal(await request("/repository", { headers: { Origin: ORIGIN } }), 401);
  assert.equal(
    await request("/repository", { headers: { ...headers, Origin: "https://attacker.test" } }),
    403,
  );
  const rebound = await new Promise((resolve, reject) => {
    const request_ = httpRequest(
      new URL("/repository", url),
      { headers: { ...headers, Host: "attacker.test" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request_.on("error", reject);
    request_.end();
  });
  assert.equal(rebound, 403);
  assert.equal(await request("/repository", { method: "POST" }), 401);
  const preflight = await fetch(new URL("/repository", url), {
    method: "OPTIONS",
    headers: { Origin: ORIGIN },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  for (const route of [
    "/unknown",
    "/history?skip=-1",
    "/diff?commit=HEAD",
    "/diff?path=../outside&area=untracked",
    "/diff?path=note.md&area=working",
  ]) {
    // eslint-disable-next-line no-await-in-loop -- Exercise each rejected endpoint independently.
    assert.equal(await request(route), 400);
  }
});
