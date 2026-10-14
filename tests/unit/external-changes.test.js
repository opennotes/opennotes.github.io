import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mount, project, directory, fileHandle } from "../support/workspace.js";

let app, c, handle, root;
async function diskText() {
  const file = await handle.getFile();
  return file.text();
}
beforeEach(async () => {
  ({ app, c } = await mount());
  handle = fileHandle("A.md", "original");
  root = directory("Notes", [handle, fileHandle("B.md", "other")]);
  await project(c, root);
  await c.openNode("A.md");
});
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search", "sidebar");
  app.stop();
});

it("never overwrites external edits when resuming a project with an old draft", async () => {
  c.editor.view.dispatch({ changes: { from: 0, to: 8, insert: "old browser draft" } });
  c.editor.cancelSave();
  handle.change("external version");
  c.recentWorkspace = { handle: root, path: "A.md" };
  await c.resumeWorkspace();
  expect(await diskText()).toBe("external version");
  expect(c.editor.view.state.doc.toString()).toBe("old browser draft");
});

it("opens external changes without writing an unchanged browser document", async () => {
  handle.change("external version");
  const createWritable = vi.spyOn(handle, "createWritable");
  c.recentWorkspace = { handle: root, path: "A.md" };
  await c.resumeWorkspace();
  expect(c.editor.view.state.doc.toString()).toBe("external version");
  expect(createWritable).not.toHaveBeenCalled();
});

it("blocks debounced autosave and offers a download of the preserved draft", async () => {
  vi.useFakeTimers();
  c.editor.view.dispatch({ changes: { from: 0, to: 8, insert: "browser draft" } });
  handle.change("external version");
  const createWritable = vi.spyOn(handle, "createWritable");
  await vi.advanceTimersByTimeAsync(600);
  expect(await diskText()).toBe("external version");
  expect(createWritable).not.toHaveBeenCalled();
  expect(c.statusTextTarget.textContent).toBe("Ошибка сохранения");
  expect(c.toastTarget.textContent).toContain("Файл изменён вне редактора");
  expect(c.editor.downloadTarget.hidden).toBe(false);
  expect(c.editor.view.state.doc.toString()).toBe("browser draft");
  expect(await c.editor.save()).toBe(false);
  expect(await diskText()).toBe("external version");
});

it("does not switch away from a conflicting draft", async () => {
  c.editor.view.dispatch({ changes: { from: 0, to: 8, insert: "browser draft" } });
  c.editor.cancelSave();
  handle.change("external version");
  await c.openNode("B.md");
  expect(c.project.currentPath).toBe("A.md");
  expect(c.editor.view.state.doc.toString()).toBe("browser draft");
  expect(await diskText()).toBe("external version");
});

it.each(["create", "write"])("aborts if the file changes during %s before commit", async (stage) => {
  const create = handle.createWritable;
  let release;
  const pause = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const abort = vi.fn();
  handle.createWritable = async () => {
    if (stage === "create") {
      await pause();
    }
    const writer = await create();
    return {
      async write(text) {
        await writer.write(text);
        if (stage === "write") {
          await pause();
        }
      },
      close: () => writer.close(),
      abort,
    };
  };
  c.editor.view.dispatch({ changes: { from: 0, to: 8, insert: "browser draft" } });
  c.editor.cancelSave();
  const saving = c.editor.save();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  handle.change("external version");
  release();
  expect(await saving).toBe(false);
  expect(abort).toHaveBeenCalledOnce();
  expect(await diskText()).toBe("external version");
});

it("does not trust unchanged size and modification time", async () => {
  const snapshot = await handle.getFile();
  vi.spyOn(handle, "getFile").mockResolvedValue(
    new File(["external"], "A.md", { lastModified: snapshot.lastModified }),
  );
  const createWritable = vi.spyOn(handle, "createWritable");
  c.editor.view.dispatch({ changes: { from: 0, to: 8, insert: "browser draft" } });
  c.editor.cancelSave();
  expect(await c.editor.save()).toBe(false);
  expect(createWritable).not.toHaveBeenCalled();
});

it.each(["one\r\ntwo", "one\rtwo", "one\ntwo", "one\r\ntwo\nthree"])(
  "never writes untouched line endings in %j",
  async (text) => {
    handle.change(text);
    c.editor.closeEditor();
    await c.openNode("A.md");
    const createWritable = vi.spyOn(handle, "createWritable");
    expect(await c.editor.save()).toBe(true);
    await c.openNode("B.md");
    expect(createWritable).not.toHaveBeenCalled();
    expect(await diskText()).toBe(text);
  },
);

it.each(["\r\n", "\r", "\n"])("preserves %j line endings while saving actual edits", async (separator) => {
  handle.change(`one${separator}two`);
  c.editor.closeEditor();
  await c.openNode("A.md");
  c.editor.view.dispatch({ changes: { from: 0, insert: "edited " } });
  c.editor.cancelSave();
  expect(await c.editor.save()).toBe(true);
  expect(await diskText()).toBe(`edited one${separator}two`);
  c.editor.view.dispatch({ changes: { from: 0, insert: "again " } });
  expect(await c.editor.save()).toBe(true);
  expect(await diskText()).toBe(`again edited one${separator}two`);
});
