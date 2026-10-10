import { expect, it, vi } from "vitest";

import { Project } from "../../src/js/files/project.js";
import { ProjectReader } from "../../src/js/files/reader.js";
import { searchProject } from "../../src/js/search/search.js";
import { directory, fileHandle } from "../support/files.js";

it("preserves the source and model if the destination cannot be created", async () => {
  const source = fileHandle("A.md", "original");
  const folder = directory("Folder");
  const root = directory("N", [source, folder]);
  const project = new Project();
  project.dirHandle = root;
  await project.scanDirectory(root, "");
  vi.spyOn(folder, "getFileHandle").mockRejectedValue(new Error("permission denied"));
  const cleanup = vi.fn();
  await expect(project.move("A.md", "Folder", { onCleanupError: cleanup })).rejects.toThrow(
    "permission denied",
  );
  expect(root.children.get("A.md")).toBe(source);
  expect(project.nodes.get("A.md").handle).toBe(source);
  expect(project.nodes.has("Folder/A.md")).toBe(false);
  expect(cleanup).not.toHaveBeenCalled();
});
it("scans, caches, searches, moves and deletes without mounting any controller", async () => {
  const source = fileHandle("A.md", "needle");
  const root = directory("N", [
    source,
    directory("Folder"),
    fileHandle(".gitignore", "*.log"),
    fileHandle("secret.log", "needle"),
  ]);
  const project = new Project();
  project.dirHandle = root;
  await project.scanDirectory(root, "");
  const reader = new ProjectReader(project);
  await reader.readNode(project.nodes.get("A.md"));
  const excluded = await project.exclusions(
    () => true,
    async (path, node) => {
      const result = await reader.readNode(node);
      return result.text;
    },
  );
  const results = await searchProject(project, {
    query: "needle",
    excluded,
    isCurrent: () => true,
    readText: (path, node) => reader.readSearchText(node),
  });
  expect(results.matches.map((match) => match.path)).toEqual(["A.md"]);
  const moved = await project.move("A.md", "Folder", { onCleanupError: vi.fn() });
  expect(moved.newPath).toBe("Folder/A.md");
  expect(await reader.readSearchText(project.nodes.get(moved.newPath))).toBe("needle");
  expect(root.children.has("A.md")).toBe(false);
  expect(await project.remove(moved.newPath)).toEqual([moved.newPath]);
  expect(project.nodes.has(moved.newPath)).toBe(false);
});

it("checks names in the map and on disk using normalized case", async () => {
  const project = new Project();
  const root = directory("N", [fileHandle("A.md"), directory("Folder", [fileHandle("B.md")])]);
  project.dirHandle = root;
  await project.scanDirectory(root, "");
  expect(await project.nameExists("", "A.md")).toBe(true);
  expect(await project.nameExists("", "a.MD")).toBe(true);
  expect(await project.nameExists("", "missing")).toBe(false);
  expect(await project.nameExists("Folder", "b.MD")).toBe(true);
  project.dirHandle = null;
  expect(await project.nameExists("", "missing")).toBe(false);
  expect(project.directoryHandle("missing")).toBeUndefined();
});
it("creates unique file and folder names", async () => {
  const project = new Project();
  const root = directory("N", [fileHandle("A.md"), directory("Folder", [fileHandle("B.md")])]);
  project.dirHandle = root;
  await project.scanDirectory(root, "");
  expect(await project.availableName("", "A.md", "file")).toBe("A (1).md");
  expect(await project.availableName("", "Folder", "directory")).toBe("Folder (1)");
  project.nodes.set("note", {});
  expect(await project.availableName("", "note", "file")).toBe("note (1)");
});
