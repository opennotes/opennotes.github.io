/* eslint security/detect-non-literal-fs-filename: "off" -- Only disposable Git fixtures are read. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { gitDirectories } from "../../src/js/git/metadata.js";
import { Repo } from "../../src/js/git/repo.js";
import { directory, fileHandle } from "../support/files.js";
import { fixtureFiles, gitFixture, nativeGit, removeFixture } from "../support/git-fixture.js";

let fixture;
let root;
let repo;

async function handles() {
  const folder = directory("notes");
  const files = await fixtureFiles(fixture.root);
  for (const entry of files) {
    const parts = entry.path.split("/");
    const name = parts.pop();
    let current = folder;
    for (const part of parts) {
      if (!current.children.has(part)) {
        current.children.set(part, directory(part));
      }
      current = current.children.get(part);
    }
    current.children.set(name, fileHandle(name, Buffer.from(entry.bytes, "base64")));
  }
  return folder;
}

beforeAll(async () => {
  fixture = await gitFixture();
  root = await handles();
  repo = new Repo(await gitDirectories(root));
});

afterAll(async () => {
  await removeFixture(fixture.root);
});

it("matches native Git status without changing the index and reads packed history", async () => {
  const indexBefore = await readFile(path.join(fixture.root, ".git/index"));
  const data = await repo.repository();
  expect(data.branch).toBe("main");
  expect(data.warning).toBe("");
  expect(data.changes).toEqual([
    { path: "deleted.md", staged: " ", working: "D" },
    { path: "new note.md", staged: "?", working: " " },
    { path: "note.md", staged: "M", working: "M" },
  ]);
  expect(data.commits[0]).toMatchObject({
    oid: fixture.oid,
    subject: "Initial notes",
    author: "Test Author",
  });
  expect(nativeGit(fixture.root, ["status", "--porcelain"])).toContain("MM note.md");
  expect(await readFile(path.join(fixture.root, ".git/index"))).toEqual(indexBefore);
});

it("compares staged, working, deleted and untracked bytes and the initial commit", async () => {
  await expect(repo.diff({ path: "note.md", area: "staged" })).resolves.toMatchObject({
    patch: expect.stringContaining("-before\n+staged"),
  });
  await expect(repo.diff({ path: "note.md", area: "working" })).resolves.toMatchObject({
    patch: expect.stringContaining("-staged\n+working"),
  });
  await expect(repo.diff({ path: "deleted.md", area: "working" })).resolves.toMatchObject({
    patch: expect.stringContaining("-gone"),
  });
  await expect(repo.diff({ path: "new note.md", area: "untracked" })).resolves.toMatchObject({
    patch: expect.stringContaining("+new note"),
  });
  await expect(repo.commit(fixture.oid)).resolves.toMatchObject({
    patch: expect.stringContaining("+before"),
  });
});

it("keeps history available when a corrupt or conflicted index cannot be read", async () => {
  const index = root.children.get(".git").children.get("index");
  const original = await index.getFile();
  index.change("corrupt");
  repo.options.cache = {};
  const data = await repo.repository();
  expect(data.changes).toBeNull();
  expect(data.warning).toContain("недоступен");
  expect(data.commits).toHaveLength(1);
  index.change(await original.arrayBuffer());
  repo.options.cache = {};
});

it("handles unborn HEAD, new staged files and staged deletions", async () => {
  const empty = directory("empty", [directory(".git", [fileHandle("HEAD", "ref: refs/heads/main\n")])]);
  const unborn = new Repo(await gitDirectories(empty));
  expect(await unborn.head()).toBe("");
  expect(await unborn.history()).toEqual({ commits: [], more: false });
  expect(await unborn.blob("note.md", "")).toHaveLength(0);
  nativeGit(fixture.root, ["add", "--all"]);
  root = await handles();
  repo = new Repo(await gitDirectories(root));
  const data = await repo.repository();
  expect(data.changes).toContainEqual({ path: "deleted.md", staged: "D", working: " " });
  expect(data.changes).toContainEqual({ path: "new note.md", staged: "A", working: " " });
});

it("reads a later commit with unchanged files and deleted blobs", async () => {
  nativeGit(fixture.root, ["commit", "-m", "Second"]);
  const committedRoot = await handles();
  const committed = new Repo(await gitDirectories(committedRoot));
  await expect(committed.commit(nativeGit(fixture.root, ["rev-parse", "HEAD"]))).resolves.toMatchObject({
    patch: expect.stringContaining("-gone"),
  });
  expect(await committed.history(1)).toMatchObject({ commits: [{ subject: "Initial notes" }] });
  const failure = vi.spyOn(repo.options.fs, "readFile").mockRejectedValue(new Error("denied"));
  await expect(repo.working("note.md")).rejects.toThrow("denied");
  failure.mockRestore();
  await writeFile(path.join(fixture.root, "note.md"), "unused\n");
});

it("excludes symbolic links and submodules instead of reporting false deletions", async () => {
  const blob = nativeGit(fixture.root, ["rev-parse", "HEAD:note.md"]);
  const head = nativeGit(fixture.root, ["rev-parse", "HEAD"]);
  nativeGit(fixture.root, ["update-index", "--add", "--cacheinfo", `120000,${blob},link`]);
  nativeGit(fixture.root, ["update-index", "--add", "--cacheinfo", `160000,${head},module`]);
  root = await handles();
  repo = new Repo(await gitDirectories(root));
  const data = await repo.repository();
  expect(data.warning).toContain("подмодули исключены");
  expect(data.changes).not.toBeNull();
  expect(data.changes.map((entry) => entry.path)).not.toContain("link");
  expect(data.changes.map((entry) => entry.path)).not.toContain("module");
  nativeGit(fixture.root, ["commit", "-m", "Special entries"]);
  const committedRoot = await handles();
  const committed = new Repo(await gitDirectories(committedRoot));
  await expect(committed.commit(nativeGit(fixture.root, ["rev-parse", "HEAD"]))).resolves.toMatchObject({
    patch: expect.stringContaining("подмодуля не сравнивается"),
  });
});

it("reports denied metadata and compares an empty repository without a first commit", async () => {
  const empty = directory("empty", [directory(".git", [fileHandle("HEAD", "ref: refs/heads/main\n")])]);
  const unborn = new Repo(await gitDirectories(empty));
  const data = await unborn.repository();
  expect(data.changes).toEqual([]);
  expect(data.commits).toEqual([]);
  vi.spyOn(unborn.options.fs, "handle").mockRejectedValue(new Error("permission denied"));
  unborn.options.cache = {};
  await expect(unborn.head()).rejects.toThrow("permission denied");
});

it("walks changed nested directories and reads their stored blobs", async () => {
  await mkdir(path.join(fixture.root, "nested"));
  await writeFile(path.join(fixture.root, "nested/deep.md"), "deep contents\n");
  nativeGit(fixture.root, ["add", "nested"]);
  nativeGit(fixture.root, ["commit", "-m", "Nested note"]);
  const nestedRoot = await handles();
  const nested = new Repo(await gitDirectories(nestedRoot));
  await expect(nested.commit(nativeGit(fixture.root, ["rev-parse", "HEAD"]))).resolves.toMatchObject({
    patch: expect.stringContaining("+deep contents"),
  });
  const blob = await nested.blob("nested/deep.md", "HEAD");
  expect(new TextDecoder().decode(blob)).toBe("deep contents\n");
});
