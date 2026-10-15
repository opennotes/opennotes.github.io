import { afterEach, expect, it } from "vitest";

import { fileIconType, nodeIcon } from "../../src/js/ui/file-icons.js";
import { mount, project, directory, fileHandle } from "../support/workspace.js";

it.each([
  ["note.MD", "md"],
  ["README.markdown", "md"],
  ["note.mdx", "md"],
  ["app.PHP", "code"],
  ["app.JS", "code"],
  ["module.d.ts", "code"],
  ["view.tsx", "code"],
  ["index.HTML", "markup"],
  ["data.xml", "markup"],
  ["style.CSS", "style"],
  ["theme.scss", "style"],
  ["config.JSON", "data"],
  ["config.yml", "data"],
  ["rows.csv", "data"],
  ["settings.ini", "config"],
  ["photo.PNG", "image"],
  ["image.svg", "image"],
  ["query.SQL", "database"],
  ["data.sqlite", "database"],
  ["run.sh", "terminal"],
  ["Makefile", "terminal"],
  [".zshrc", "terminal"],
  [".gitignore", "git"],
  [".gitattributes", "git"],
  [".gitmodules", "git"],
  [".gitkeep", "git"],
  [".editorconfig", "config"],
  ["Dockerfile", "config"],
  [".env", "config"],
  [".env.production", "config"],
  [".env.example", "config"],
  [".config.json", "data"],
  [".hidden.md", "md"],
  [".unknown", "dotFile"],
  [".cache.custom", "dotFile"],
  [".gitignore.bak", "dotFile"],
  ["notes.txt", "file"],
  ["LICENSE", "file"],
  ["unknown.custom", "file"],
  ["__proto__", "file"],
  ["constructor", "file"],
])("chooses %s by known name and format as %s", (name, type) => {
  expect(fileIconType({ name, kind: "file" })).toBe(type);
});

it.each([
  ["src", "folder"],
  [".github", "dotFolder"],
  ["data.json", "folder"],
  [".gitignore", "dotFolder"],
])("keeps directory semantics for %s", (name, type) => {
  expect(fileIconType({ name, kind: "directory" })).toBe(type);
  const element = document.createElement("div");
  element.innerHTML = nodeIcon({ name, kind: "directory" });
  expect(element.querySelector(".chevron")).not.toBeNull();
  expect(element.querySelector(".ico").dataset.fileIcon).toBe(type);
});

it("renders decorative icons without interpolating filenames as markup", () => {
  const element = document.createElement("div");
  element.innerHTML = nodeIcon({ name: '<img src=x onerror="alert(1)">.js', kind: "file" });
  expect(element.querySelector("img")).toBeNull();
  expect(element.querySelector(".chevron")).toBeNull();
  const icon = element.querySelector(".ico");
  expect(icon.dataset.fileIcon).toBe("code");
  expect(icon.getAttribute("aria-hidden")).toBe("true");
  expect(icon.getAttribute("focusable")).toBe("false");
  expect(element.querySelector(".spacer").getAttribute("aria-hidden")).toBe("true");
});

let c, app;
afterEach(() => {
  app?.unload("workspace", "tree", "editor", "search", "sidebar");
  app?.stop();
});

it("updates the icon after a rename and preserves the selected file and draft", async () => {
  ({ c, app } = await mount());
  await project(c, directory("Notes", [fileHandle("A.md", "draft")]));
  await c.openNode("A.md");
  c.editor.view.dispatch({ changes: { from: 0, insert: "keep " } });
  await c.moveNode("A.md", "", { requestedName: "A.ts", shouldPropagate: true });
  const row = c.tree.treeRows.get("A.ts");
  expect(row.querySelector(".ico").dataset.fileIcon).toBe("code");
  expect(row.getAttribute("aria-selected")).toBe("true");
  expect(row.querySelector(".label").textContent).toBe("A.ts");
  expect(c.project.currentPath).toBe("A.ts");
  expect(c.editor.view.state.doc.toString()).toBe("keep draft");
  await c.moveNode("A.ts", "", { requestedName: ".gitignore", shouldPropagate: true });
  expect(c.tree.treeRows.get(".gitignore").querySelector(".ico").dataset.fileIcon).toBe("git");
});

it("retains dot-folder icons and accessible names when expanded", async () => {
  ({ c, app } = await mount());
  await project(c, directory("Notes", [directory(".github", [fileHandle("ci.yml", "name: CI")])]));
  c.tree.toggleExpand(".github");
  const folder = c.tree.treeRows.get(".github");
  expect(folder.getAttribute("aria-label")).toBe(".github");
  expect(folder.getAttribute("aria-expanded")).toBe("true");
  expect(folder.querySelector(".ico").dataset.fileIcon).toBe("dotFolder");
  expect(c.tree.treeRows.get(".github/ci.yml").querySelector(".ico").dataset.fileIcon).toBe("data");
});
