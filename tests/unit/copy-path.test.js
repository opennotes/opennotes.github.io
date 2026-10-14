import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mount, project, directory, fileHandle } from "../support/workspace.js";

let c, app, writeText;
beforeEach(async () => {
  ({ c, app } = await mount());
  await project(
    c,
    directory("Notes", [
      fileHandle("Active.md", "active"),
      directory("Мои заметки", [fileHandle("A B.md", "nested")]),
    ]),
  );
  await c.openNode("Active.md");
  writeText = vi.fn().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search", "sidebar");
  app.stop();
  delete navigator.clipboard;
});

it.each(["Active.md", "Мои заметки", "Мои заметки/A B.md"])(
  "copies the context path %s without changing the open file",
  async (path) => {
    c.tree.expanded.add("Мои заметки");
    c.tree.renderTree();
    c.tree.contextPath = path;
    c.tree.contextMenuTarget.hidden = false;
    await c.tree.copyPath();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(path);
    expect(c.tree.contextMenuTarget.hidden).toBe(true);
    expect(c.toastTarget.textContent).toBe("Путь скопирован");
    expect(document.activeElement).toBe(c.tree.treeRows.get(path));
    expect(c.project.currentPath).toBe("Active.md");
    expect(c.editor.view.state.doc.toString()).toBe("active");
  },
);

it("reports denied clipboard access without a success message", async () => {
  c.tree.contextPath = "Active.md";
  writeText.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  await c.tree.copyPath();
  expect(c.toastTarget.textContent).toBe("Не удалось скопировать путь");
  expect(c.tree.contextMenuTarget.hidden).toBe(true);
});

it("reports an unavailable clipboard", async () => {
  c.tree.contextPath = "Active.md";
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  await c.tree.copyPath();
  expect(c.toastTarget.textContent).toBe("Не удалось скопировать путь");
});

it("ignores missing nodes and busy file operations", async () => {
  c.tree.contextPath = "missing.md";
  await c.tree.copyPath();
  c.tree.contextPath = "Active.md";
  c.project.operationBusy = true;
  await c.tree.copyPath();
  expect(writeText).not.toHaveBeenCalled();
});
