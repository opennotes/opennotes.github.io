import * as diff from "diff";
import { expect, it, vi } from "vitest";

import { GitFileSystem } from "../../src/js/git/filesystem.js";
import { gitBranch, gitDirectories } from "../../src/js/git/metadata.js";
import { comparison } from "../../src/js/git/patch.js";
import { directory, fileHandle } from "../support/files.js";

vi.mock("diff", { spy: true });

function example() {
  const metadata = directory(".git", [fileHandle("HEAD", "ref: refs/heads/main\n")]);
  const root = directory("notes", [metadata, fileHandle("note.md", "text\n"), directory("nested")]);
  return {
    root,
    metadata,
    fs: new GitFileSystem({ root, gitdir: metadata, common: metadata }),
  };
}

it("reads live handles, metadata, byte buffers, directories and conservative stats", async () => {
  const { root, fs } = example();
  expect(await fs.promises.readFile("/repo/./note.md", "utf8")).toBe("text\n");
  expect(await fs.promises.readFile("/repo/note.md", { encoding: "utf8" })).toBe("text\n");
  expect(await fs.promises.readFile("/repo/note.md")).toBeInstanceOf(Uint8Array);
  expect(await fs.promises.readdir("/repo")).toEqual([".git", "note.md", "nested"]);
  const folderStat = await fs.promises.stat("/repo");
  expect(folderStat.isDirectory()).toBe(true);
  expect(folderStat.isFile()).toBe(false);
  const stat = await fs.promises.lstat("/repo/note.md");
  expect(stat.isFile()).toBe(true);
  expect(stat.isDirectory()).toBe(false);
  expect(stat.isSymbolicLink()).toBe(false);
  const definition = await gitDirectories(root);
  expect(await gitBranch(definition)).toBe("main");
  definition.gitdir.children.get("HEAD").change("abc123456789\n");
  expect(await gitBranch(definition)).toBe("detached HEAD · abc12345");
});

it("rejects traversal, missing paths, permission failures and every write operation", async () => {
  const { fs, root } = example();
  for (const path of [
    null,
    "/elsewhere",
    "/repo/../file",
    "/repo/\0",
    "/repo/missing",
    "/repo/note.md/child",
  ]) {
    // eslint-disable-next-line no-await-in-loop -- Each boundary case must fail independently.
    await expect(fs.handle(path)).rejects.toMatchObject({ code: "ENOENT" });
  }
  await expect(fs.readFile("/repo/nested")).rejects.toMatchObject({ code: "EISDIR" });
  await expect(fs.readdir("/repo/note.md")).rejects.toMatchObject({ code: "ENOTDIR" });
  const methods = ["writeFile", "mkdir", "rmdir", "unlink", "readlink", "symlink"];
  for (const method of methods) {
    // eslint-disable-next-line no-await-in-loop -- Exercise each mandatory filesystem API.
    await expect(fs.promises[method]()).rejects.toMatchObject({ code: "EROFS" });
  }
  vi.spyOn(root, "getDirectoryHandle").mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  await expect(fs.handle("/repo/file")).rejects.toMatchObject({ name: "NotAllowedError" });
});

it("checks file sizes before allocating buffers", async () => {
  const { fs, root, metadata } = example();
  const large = fileHandle("large");
  large.getFile = vi.fn().mockResolvedValue({ size: 134_217_729 });
  root.children.set("large", large);
  metadata.children.set("large", large);
  await expect(fs.readFile("/repo/large")).rejects.toMatchObject({ code: "TOO_LARGE" });
  await expect(fs.readFile("/repo/.git/large")).rejects.toMatchObject({ code: "TOO_LARGE" });
});

it("explains folders without Git and handles unsupported repository layouts", async () => {
  await expect(gitDirectories(null)).rejects.toMatchObject({ code: "NO_FOLDER" });
  await expect(gitDirectories(directory("empty"))).rejects.toMatchObject({ code: "NOT_REPOSITORY" });
  const external = directory("notes", [fileHandle(".git", "gitdir: /other/location\n")]);
  await expect(gitDirectories(external)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  const root = directory("denied");
  vi.spyOn(root, "getDirectoryHandle").mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  await expect(gitDirectories(root)).rejects.toMatchObject({ name: "NotAllowedError" });
});

it("requires a worktree grant and overlays private HEAD/index over common objects", async () => {
  const root = directory("linked", [fileHandle(".git", "gitdir: /main/.git/worktrees/linked\n")]);
  await expect(gitDirectories(root)).rejects.toMatchObject({ code: "WORKTREE" });
  const privateDirectory = directory("linked", [
    fileHandle("HEAD", "ref: refs/heads/feature\n"),
    fileHandle("commondir", "../..\n"),
    fileHandle("index", "private"),
  ]);
  const shared = directory(".git", [
    directory("worktrees", [privateDirectory]),
    fileHandle("config", "shared"),
    directory("refs", [directory("heads", [fileHandle("feature", "oid")])]),
  ]);
  const main = directory("main", [shared]);
  const definition = await gitDirectories(root, main);
  expect(await gitBranch(definition)).toBe("feature");
  const fs = new GitFileSystem(definition);
  expect(await fs.readFile("/repo/.git/index", "utf8")).toBe("private");
  expect(await fs.readFile("/repo/.git/config", "utf8")).toBe("shared");
  expect(await fs.readFile("/repo/.git/refs/heads/feature", "utf8")).toBe("oid");
  privateDirectory.children.set(
    "refs",
    directory("refs", [directory("worktree", [fileHandle("test", "private")])]),
  );
  expect(await fs.readFile("/repo/.git/refs/worktree/test", "utf8")).toBe("private");
  privateDirectory.children.get("commondir").change("/unknown");
  await expect(gitDirectories(root, main)).rejects.toMatchObject({ code: "UNSUPPORTED" });
});

it("renders bounded UTF-8 diffs and makes binary and oversized comparisons explicit", () => {
  const bytes = (value) => new TextEncoder().encode(value);
  expect(comparison({ path: "note", before: bytes("before\n"), after: bytes("after\n") }).patch).toContain(
    "-before\n+after",
  );
  expect(comparison({ path: "binary", before: new Uint8Array([0]) }).patch).toContain("двоичный");
  expect(comparison({ path: "binary", after: new Uint8Array([0]) }).patch).toContain("двоичный");
  expect(comparison({ path: "invalid", after: new Uint8Array([255]) }).patch).toContain("не в UTF-8");
  expect(comparison({ path: "large", after: new Uint8Array(1_048_577) }).patch).toContain("слишком большой");
  expect(
    comparison({ path: "crlf", before: bytes("line\n"), after: bytes("line\r\n"), autocrlf: true }),
  ).not.toContain("@@");
  expect(
    comparison({ path: "crlf", before: bytes("line\n"), after: bytes("line\r\n"), autocrlf: "true" }),
  ).not.toContain("@@");
});

it("explains a comparison that exceeds its processing budget", () => {
  const patch = vi.spyOn(diff, "createTwoFilesPatch").mockReturnValueOnce();
  expect(comparison({ path: "complex" }).patch).toContain("слишком сложное");
  patch.mockRestore();
});
