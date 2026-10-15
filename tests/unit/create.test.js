import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mount, project, directory, fileHandle } from "../support/workspace.js";

let c, app;
beforeEach(async () => {
  ({ c, app } = await mount());
  await project(c, directory("Notes", [fileHandle("A.md", "draft"), directory("Docs")]));
  c.setProjectName("Notes");
});
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search", "sidebar");
  app.stop();
});

function enter(path) {
  c.tree.actionInputTarget.value = path;
  c.tree.actionInputTarget.dispatchEvent(new Event("input", { bubbles: true }));
}
async function submit() {
  await c.tree.submitAction({ preventDefault: vi.fn() });
}

it("opens one root dialog, infers types and previews the full project path", () => {
  document.querySelector('[data-action="tree#createRoot"]').click();
  expect(c.tree.actionDialogTarget.open).toBe(true);
  expect(document.activeElement).toBe(c.tree.actionInputTarget);
  expect(c.tree.creationHintTarget.textContent).toBe("Папка · Notes");
  enter("Docs/drafts/note.ts");
  expect(c.tree.creationKindTarget.value).toBe("file");
  expect(c.tree.creationHintTarget.textContent).toBe("Файл · Notes/Docs/drafts/note.ts");
  enter("Docs/drafts");
  expect(c.tree.creationKindTarget.value).toBe("directory");
  expect(c.tree.creationHintTarget.textContent).toBe("Папка · Notes/Docs/drafts");
  enter("../bad");
  expect(c.tree.creationHintTarget.textContent).toBe("Папка · Notes/../bad");
});

it("preserves an explicit kind while typing and resets it next time", async () => {
  c.tree.createRoot();
  enter("no-extension");
  c.tree.creationKindTarget.value = "file";
  c.tree.creationKindTarget.dispatchEvent(new Event("change", { bubbles: true }));
  enter("other-name");
  expect(c.tree.creationHintTarget.textContent).toBe("Файл · Notes/other-name");
  await submit();
  expect(c.project.nodes.get("other-name").kind).toBe("file");
  expect(c.project.currentPath).toBe("other-name");
  c.tree.createRoot();
  enter("release.v1");
  c.tree.creationKindTarget.value = "directory";
  c.tree.chooseCreationKind();
  await submit();
  expect(c.project.nodes.get("release.v1").kind).toBe("directory");
  expect(c.project.currentPath).toBe("other-name");
});

it("creates a nested file, saves the active draft and opens the new empty editor", async () => {
  await c.openNode("A.md");
  const old = c.project.fileHandle;
  c.editor.view.dispatch({ changes: { from: 0, insert: "keep " } });
  c.tree.contextPath = "Docs";
  c.tree.createSelected();
  enter("Nested/new.json");
  expect(c.tree.creationHintTarget.textContent).toBe("Файл · Notes/Docs/Nested/new.json");
  await submit();
  expect(c.tree.actionDialogTarget.open).toBe(false);
  expect(c.project.currentPath).toBe("Docs/Nested/new.json");
  expect(c.editor.view.state.sliceDoc()).toBe("");
  const file = await old.getFile();
  expect(await file.text()).toBe("keep draft");
  expect(c.tree.treeRows.get("Docs/Nested/new.json").getAttribute("aria-selected")).toBe("true");
  expect(c.tree.expanded.has("Docs/Nested")).toBe(true);
  expect(c.project.operationBusy).toBe(false);
});

it("creates beside a context file and focuses new directories without switching the document", async () => {
  await c.openNode("A.md");
  const view = c.editor.view;
  c.tree.contextPath = "A.md";
  c.tree.createSelected();
  enter("new/nested");
  await submit();
  expect(c.project.nodes.get("new/nested").kind).toBe("directory");
  expect(document.activeElement).toBe(c.tree.treeRows.get("new/nested"));
  expect(c.editor.view).toBe(view);
  expect(c.project.currentPath).toBe("A.md");
  expect(c.statusTextTarget.textContent).toBe("Создано на диске");
});

it("keeps the dialog open for invalid paths, collisions and removed destinations", async () => {
  c.tree.createRoot();
  enter("../note.md");
  await submit();
  expect(c.tree.actionDialogTarget.open).toBe(true);
  expect(c.tree.actionErrorTarget.textContent).toContain("Введите относительный путь");
  expect(c.tree.actionSubmitTarget.disabled).toBe(false);
  enter("A.md");
  await submit();
  expect(c.tree.actionErrorTarget.textContent).toContain("уже существует");
  c.tree.cancelAction();
  c.tree.contextPath = "Docs";
  c.tree.createSelected();
  c.project.nodes.delete("Docs");
  enter("new.md");
  await submit();
  expect(c.tree.actionErrorTarget.textContent).toContain("больше не существует");
  expect(c.project.operationBusy).toBe(false);
});

it("blocks concurrent creation and creation while a document is opening", async () => {
  c.project.operationBusy = true;
  c.tree.createRoot();
  expect(c.tree.actionDialogTarget.open).toBe(false);
  await expect(c.createNode({ path: "new.md" })).rejects.toThrow("Дождитесь");
  c.project.operationBusy = false;
  c.openingTarget.hidden = false;
  await expect(c.createNode({ path: "new.md" })).rejects.toThrow("Дождитесь");
  expect(c.project.nodes.has("new.md")).toBe(false);
});

it("retains the draft and filesystem when saving fails", async () => {
  await c.openNode("A.md");
  c.editor.view.dispatch({ changes: { from: 0, insert: "keep " } });
  vi.spyOn(c.editor, "save").mockResolvedValue(false);
  await expect(c.createNode({ path: "new/note.md" })).rejects.toThrow("Создание отменено");
  expect(c.project.nodes.has("new")).toBe(false);
  expect(c.editor.view.state.sliceDoc()).toBe("keep draft");
  expect(c.project.operationBusy).toBe(false);
  expect(c.editor.editorTarget.inert).toBe(false);
});

it("asks for the containing directory when only a writable standalone file is open", async () => {
  await c.openNode("A.md");
  c.project.dirHandle = null;
  await expect(c.createNode({ path: "new.md" })).rejects.toThrow("откройте содержащую файл папку");
  expect(c.project.nodes.has("new.md")).toBe(false);
});

it("creates a downloadable project without a disk folder and preserves earlier drafts", async () => {
  c.project.dirHandle = null;
  c.project.workspaceIsDirectory = false;
  c.project.nodes.clear();
  c.tree.refresh();
  c.tree.createRoot();
  enter("docs/note.md");
  expect(c.tree.creationHintTarget.textContent).toBe("Файл · Новый проект/docs/note.md");
  await submit();
  expect(c.rootNameTarget.textContent).toBe("Новый проект");
  expect(c.editor.downloadTarget.hidden).toBe(false);
  c.editor.view.dispatch({ changes: { from: 0, insert: "unsaved" } });
  await c.createNode({ path: "another.md" });
  await c.openNode("docs/note.md");
  expect(c.editor.view.state.sliceDoc()).toBe("unsaved");
  await c.createNode({ path: "empty" });
  expect(c.statusTextTarget.textContent).toBe("Создано в проекте");
});

it("shares cancellation and rename UI without retaining creation controls", () => {
  c.tree.contextPath = "missing";
  c.tree.createSelected();
  expect(c.tree.actionDialogTarget.open).toBe(false);
  c.tree.updateCreation();
  c.tree.createRoot();
  c.tree.cancelAction();
  c.tree.contextPath = "A.md";
  c.tree.renameSelected();
  expect(c.tree.creationOptionsTarget.hidden).toBe(true);
  expect(c.tree.actionInputTarget.getAttribute("aria-label")).toBe("Новое имя");
  c.tree.updateCreation();
  expect(c.tree.actionInputTarget.placeholder).toBe("");
});

it("keeps a pending creation modal stable and ignores duplicate submissions", async () => {
  let release;
  const create = vi.spyOn(c, "createNode").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  c.tree.createRoot();
  enter("Docs");
  const pending = submit();
  expect(c.tree.actionInputTarget.disabled).toBe(true);
  expect(c.tree.creationKindTarget.disabled).toBe(true);
  c.tree.cancelAction();
  c.tree.createRoot();
  c.tree.contextPath = "A.md";
  c.tree.renameSelected();
  const cancel = new Event("cancel", { cancelable: true });
  c.tree.actionDialogTarget.dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(c.tree.actionDialogTarget.open).toBe(true);
  await submit();
  expect(create).toHaveBeenCalledTimes(1);
  release({ path: "Docs", kind: "directory" });
  await pending;
  expect(c.tree.actionDialogTarget.open).toBe(false);
  expect(c.tree.actionInputTarget.disabled).toBe(false);
});

it("focuses the tree for a newly created binary preview", async () => {
  c.tree.createRoot();
  enter("new.png");
  await submit();
  expect(c.editor.hasDocument).toBe(false);
  expect(c.editor.previewFile.name).toBe("new.png");
  expect(document.activeElement).toBe(c.tree.treeRows.get("new.png"));
});
