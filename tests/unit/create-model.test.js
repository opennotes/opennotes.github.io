import { expect, it, vi } from "vitest";

import { createEntry, parseCreationPath } from "../../src/js/files/create.js";
import { Project } from "../../src/js/files/project.js";
import { directory, fileHandle } from "../support/files.js";

it.each([
  ["директория", "directory"],
  ["директория/директория", "directory"],
  ["директория/директория/файл.расширение", "file"],
  ["файл.расширение", "file"],
  ["src/main.ts", "file"],
  [".gitignore", "file"],
  [".env", "file"],
  [".github", "directory"],
  ["README", "file"],
  ["Makefile", "file"],
  ["release.v1/", "directory"],
  [" Мои заметки/Идея.md ", "file"],
])("infers %s as %s", (path, kind) => {
  expect(parseCreationPath(path).kind).toBe(kind);
});

it("supports explicit choices without changing valid path components", () => {
  expect(parseCreationPath("release.v1", "directory")).toEqual({
    path: "release.v1",
    parts: ["release.v1"],
    kind: "directory",
  });
  expect(parseCreationPath("note", "file").kind).toBe("file");
  expect(parseCreationPath("note/", "file").path).toBe("note");
  expect(() => parseCreationPath("note", "unknown")).toThrow("Выберите файл или папку");
});

it.each([
  "",
  " ",
  "/",
  "/absolute/file.md",
  "../file.md",
  "a/../b",
  "a/./b",
  "a//b",
  "a//",
  "C:/file.md",
  String.raw`a\file.md`,
  "a/ b",
  "a /b",
  "file.",
  "a\u{0}b",
  "a\u{1F}b",
  "a\u{7F}b",
  "a\nb",
  'a"b',
  "a?b",
  "a*b",
  "a|b",
  "a<b",
  "a>b",
])("rejects invalid relative path %j", (path) => {
  expect(() => parseCreationPath(path)).toThrow("Введите относительный путь");
});

async function native(root = directory("Notes")) {
  const project = new Project();
  project.dirHandle = root;
  await project.scanDirectory(root, "");
  return {
    project,
    root,
  };
}

it.each([
  ["note.md", "file"],
  ["Notes", "directory"],
  ["docs/drafts/note.md", "file"],
  ["docs/drafts", "directory"],
])("creates %s on disk and commits all intermediate nodes", async (path, kind) => {
  const { project, root } = await native();
  expect(await createEntry(project, { path })).toEqual({ path, kind });
  expect(project.nodes.get(path).kind).toBe(kind);
  expect(root.children.has(path.split("/", 1)[0])).toBe(true);
});

it("reuses canonical directory names and creates relative to a selected folder", async () => {
  const { project, root } = await native(directory("Notes", [directory("Docs", [directory("Drafts")])]));
  const result = await createEntry(project, { parentPath: "Docs", path: "drafts/new.md" });
  expect(result.path).toBe("Docs/Drafts/new.md");
  expect(root.children.get("Docs").children.get("Drafts").children.has("new.md")).toBe(true);
  expect(root.children.get("Docs").children.has("drafts")).toBe(false);
});

it("preserves disk contents and rejects stale or case-normalized collisions", async () => {
  const handle = fileHandle("É.md", "existing");
  const { project, root } = await native();
  root.children.set(handle.name, handle);
  const writer = vi.spyOn(handle, "createWritable");
  await expect(createEntry(project, { path: "e\u{301}.MD" })).rejects.toThrow("уже существует");
  expect(writer).not.toHaveBeenCalled();
  const file = await handle.getFile();
  expect(await file.text()).toBe("existing");
  expect(project.nodes.size).toBe(0);
});

it("rejects file ancestors, duplicate directories and removed destinations", async () => {
  const { project } = await native(directory("Notes", [fileHandle("docs"), directory("Folder")]));
  await expect(createEntry(project, { path: "docs/note.md" })).rejects.toThrow("файл, а не папка");
  await expect(createEntry(project, { path: "Folder" })).rejects.toThrow("уже существует");
  await expect(createEntry(project, { parentPath: "missing", path: "note.md" })).rejects.toThrow(
    "больше не существует",
  );
  await expect(createEntry(project, { parentPath: "docs", path: "note.md" })).rejects.toThrow(
    "больше не существует",
  );
});

it("creates browser-only folders and downloadable files without disk writes", async () => {
  const project = new Project();
  await createEntry(project, { path: "docs/drafts/new.md" });
  const handle = project.nodes.get("docs/drafts/new.md").handle;
  expect(handle.createWritable).toBeUndefined();
  const file = await handle.getFile();
  expect(await file.text()).toBe("");
  expect(await createEntry(project, { path: "DOCS/README" })).toEqual({ path: "docs/README", kind: "file" });
  await expect(createEntry(project, { path: "docs/readme" })).rejects.toThrow("уже существует");
  await expect(createEntry(project, { path: "docs/README/note.md" })).rejects.toThrow("файл, а не папка");
  expect(await createEntry(project, { parentPath: "docs", path: "archive" })).toEqual({
    path: "docs/archive",
    kind: "directory",
  });
});

it("rolls back only newly created empty folders after native creation fails", async () => {
  const { project, root } = await native();
  const remove = vi.spyOn(root, "removeEntry");
  const original = root.getDirectoryHandle.bind(root);
  vi.spyOn(root, "getDirectoryHandle").mockImplementation(async (...args) => {
    const folder = await original(...args);
    vi.spyOn(folder, "getFileHandle").mockRejectedValue(new Error("denied"));
    return folder;
  });
  await expect(createEntry(project, { path: "docs/note.md" })).rejects.toThrow("denied");
  expect(remove).toHaveBeenCalledExactlyOnceWith("docs");
  expect(root.children.size).toBe(0);
  expect(project.nodes.size).toBe(0);
});

it("reports incomplete cleanup without recursively deleting someone else's files", async () => {
  const { project, root } = await native();
  const original = root.getDirectoryHandle.bind(root);
  vi.spyOn(root, "getDirectoryHandle").mockImplementation(async (...args) => {
    const folder = await original(...args);
    vi.spyOn(folder, "getFileHandle").mockImplementation(() => {
      folder.children.set("other.md", fileHandle("other.md", "external"));
      throw new Error("denied");
    });
    return folder;
  });
  const remove = vi
    .spyOn(root, "removeEntry")
    .mockRejectedValue(new DOMException("Not empty", "InvalidModificationError"));
  await expect(createEntry(project, { path: "docs/note.md" })).rejects.toThrow(
    "Проверьте оставшиеся папки: docs",
  );
  expect(remove).toHaveBeenCalledExactlyOnceWith("docs");
  expect(root.children.get("docs").children.has("other.md")).toBe(true);
  expect(project.nodes.size).toBe(0);
});

it("keeps existing directories when access is denied", async () => {
  const folder = directory("Docs");
  const { project, root } = await native(directory("Notes", [folder]));
  vi.spyOn(folder, "getFileHandle").mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  await expect(createEntry(project, { path: "Docs/note.md" })).rejects.toThrow("Denied");
  expect(root.children.get("Docs")).toBe(folder);
  expect(project.nodes.size).toBe(1);
});

it("creates an empty native file ready for subsequent editor writes", async () => {
  const { project } = await native();
  await createEntry(project, { path: "empty.md" });
  const file = await project.nodes.get("empty.md").handle.getFile();
  expect(await file.text()).toBe("");
});
