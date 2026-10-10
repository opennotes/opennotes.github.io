import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mount, project, directory, fileHandle } from "../support/workspace.js";

let c, app;
beforeEach(async () => ({ c, app } = await mount()));
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search");
  app.stop();
});
it("updates the tree after saving gitignore and restores newly included disk files", async () => {
  await project(
    c,
    directory("N", [
      fileHandle(".gitignore", "A.md"),
      fileHandle("A.md", "needle"),
      fileHandle("B.md", "visible"),
    ]),
  );
  await c.openNode(".gitignore");
  c.search.openSearch();
  c.editor.view.dispatch({ changes: { from: 0, to: 4, insert: "B.md" } });
  clearTimeout(c.editor.saveTimer);
  await c.editor.save();
  await vi.waitFor(() => {
    expect(c.project.nodes.has("A.md")).toBe(true);
    expect(c.project.nodes.has("B.md")).toBe(false);
  });
  expect(c.editor.view.state.doc.toString()).toBe("B.md");
  expect(c.tree.treeRows.has("B.md")).toBe(false);
});
it("refreshes rules on rename, moving folders with gitignore, and deletion", async () => {
  await project(
    c,
    directory("N", [
      fileHandle(".gitignore", "A.md"),
      fileHandle("A.md", "needle"),
      directory("Docs", [fileHandle(".gitignore", "B.md"), fileHandle("B.md", "hidden")]),
    ]),
  );
  await c.moveNode(".gitignore", "", { requestedName: "rules.txt" });
  expect(c.project.nodes.has("A.md")).toBe(true);
  await c.moveNode("rules.txt", "", { requestedName: ".gitignore" });
  expect(c.project.nodes.has("A.md")).toBe(false);
  await c.moveNode("Docs", "", { requestedName: "Renamed" });
  expect(c.project.nodes.has("Renamed/.gitignore")).toBe(true);
  expect(c.project.nodes.has("Renamed/B.md")).toBe(false);
  await c.removeNode(".gitignore");
  expect(c.project.nodes.has("A.md")).toBe(true);
});
it("closes an active file when updated rules exclude it", async () => {
  const rules = fileHandle(".gitignore", "");
  await project(c, directory("N", [rules, fileHandle("A.md", "needle")]));
  await c.openNode("A.md");
  rules.change("A.md");
  await c.refreshExclusions();
  expect(c.project.currentPath).toBeNull();
  expect(c.editor.hasDocument).toBe(false);
});
it("applies new exclusions to uploaded folders without reading excluded content", async () => {
  await project(c, directory("N", [fileHandle(".gitignore", ""), fileHandle("A.md", "needle")]));
  c.project.dirHandle = null;
  c.project.nodes.get(".gitignore").text = "A.md";
  await c.refreshExclusions();
  expect(c.project.nodes.has("A.md")).toBe(false);
});
it("keeps the previous tree and reports an unreadable ignore file", async () => {
  const rules = fileHandle(".gitignore", "");
  await project(c, directory("N", [rules, fileHandle("A.md", "needle")]));
  const nodes = c.project.nodes;
  vi.spyOn(rules, "getFile").mockRejectedValue(new Error("denied"));
  await c.refreshExclusions();
  expect(c.project.nodes).toBe(nodes);
  expect(c.toastTarget.textContent).toContain("Не удалось обновить правила");
});
it("discards a rescan if the project changes while rules are read", async () => {
  await project(c, directory("N", [fileHandle(".gitignore", "")]));
  const nodes = c.project.nodes;
  vi.spyOn(c, "readText").mockImplementation(async () => {
    c.project.projectVersion++;
    return "A.md";
  });
  await c.refreshExclusions();
  expect(c.project.nodes).toBe(nodes);
});
it("loads nested rules when a previously excluded directory becomes visible", async () => {
  const rules = fileHandle(".gitignore", "Docs/");
  await project(
    c,
    directory("N", [
      rules,
      directory("Docs", [
        fileHandle(".gitignore", "B.md"),
        fileHandle("A.md", "visible"),
        fileHandle("B.md", "hidden"),
      ]),
    ]),
  );
  expect(c.project.nodes.has("Docs")).toBe(false);
  rules.change("");
  await c.refreshExclusions();
  expect(c.project.nodes.has("Docs/A.md")).toBe(true);
  expect(c.project.nodes.has("Docs/B.md")).toBe(false);
});
it("refreshes uploaded-folder rules as the user edits gitignore", async () => {
  await project(c, directory("N", [fileHandle(".gitignore", ""), fileHandle("A.md", "needle")]));
  c.project.dirHandle = null;
  for (const node of c.project.nodes.values()) {
    delete node.handle.createWritable;
  }
  await c.openNode(".gitignore");
  c.editor.view.dispatch({ changes: { from: 0, insert: "A.md" } });
  await vi.waitFor(() => expect(c.project.nodes.has("A.md")).toBe(false));
  expect(c.editor.view.state.doc.toString()).toBe("A.md");
});
it("does not apply outdated uploaded-folder rules after a newer edit", async () => {
  await project(c, directory("N", [fileHandle(".gitignore", ""), fileHandle("A.md", "needle")]));
  c.project.dirHandle = null;
  vi.spyOn(c, "readText").mockImplementation(async () => {
    c.project.projectVersion++;
    return "A.md";
  });
  await c.refreshExclusions();
  expect(c.project.nodes.has("A.md")).toBe(true);
});
it("cancels uploaded-folder refresh if the project changes while the ignore library loads", async () => {
  await project(c, directory("N", [fileHandle(".gitignore", ""), fileHandle("A.md", "needle")]));
  c.project.dirHandle = null;
  c.project.ignoreFactoryPromise = null;
  vi.spyOn(c.project, "loadIgnore").mockImplementation(async () => {
    c.project.projectVersion++;
    return import("ignore");
  });
  await c.refreshExclusions();
  expect(c.project.nodes.has("A.md")).toBe(true);
});
it("keeps an unsaved uploaded gitignore available for download when its rules exclude itself", async () => {
  await project(c, directory("N", [fileHandle(".gitignore", ""), fileHandle("A.md", "needle")]));
  c.project.dirHandle = null;
  for (const node of c.project.nodes.values()) {
    delete node.handle.createWritable;
  }
  await c.openNode(".gitignore");
  c.editor.view.dispatch({ changes: { from: 0, insert: "*" } });
  await vi.waitFor(() => expect(c.project.nodes.size).toBe(0));
  expect(c.editor.hasDocument).toBe(true);
  expect(c.editor.view.state.doc.toString()).toBe("*");
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  c.editor.downloadFile();
  expect(click).toHaveBeenCalled();
});
