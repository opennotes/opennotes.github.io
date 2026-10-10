import { beforeEach, afterEach, it, expect, vi, describe } from "vitest";

import { mount, fileHandle, directory, project } from "../support/workspace.js";

let c, app;
beforeEach(async () => {
  ({ c, app } = await mount());
});
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search");
  app.stop();
});
const event = () => ({ preventDefault: vi.fn() });
async function notes() {
  await project(
    c,
    directory("Notes", [
      fileHandle("A.md", "Alpha"),
      directory("Folder", [fileHandle("B.md", "Beta")]),
      directory("Empty"),
    ]),
  );
}
describe("Pickers and recent workspace", () => {
  it.each(["openFile", "openDirectory"])("uses fallback and ignores busy %s", async (method) => {
    const target = method === "openFile" ? c.fileInputTarget : c.directoryInputTarget;
    const click = vi.spyOn(target, "click");
    await c[method]();
    expect(click).toHaveBeenCalledOnce();
    c.project.operationBusy = true;
    await c[method]();
    expect(click).toHaveBeenCalledOnce();
  });
  it("opens directory and remembers it", async () => {
    c.apiOk = true;
    globalThis.showDirectoryPicker = vi.fn(async () => directory("Picked", [fileHandle("A.md", "text")]));
    vi.spyOn(c, "workspaceSetting").mockResolvedValue();
    await c.openDirectory();
    expect(c.rootNameTarget.textContent).toBe("Picked");
    expect(c.project.currentPath).toBeNull();
    expect(c.recentWorkspace.handle.name).toBe("Picked");
    delete globalThis.showDirectoryPicker;
  });
  it("opens a standalone file and remembers it", async () => {
    c.apiOk = true;
    globalThis.showOpenFilePicker = vi.fn(async () => [fileHandle("Picked.md", "text")]);
    vi.spyOn(c, "workspaceSetting").mockResolvedValue();
    await c.openFile();
    expect(c.project.currentPath).toBe("Picked.md");
    expect(c.project.dirHandle).toBeNull();
    delete globalThis.showOpenFilePicker;
  });
  it.each(["openFile", "openDirectory"])("preserves editor after failed save in %s", async (method) => {
    await notes();
    await c.openNode("A.md");
    c.apiOk = true;
    globalThis.showDirectoryPicker = async () => directory("New");
    globalThis.showOpenFilePicker = async () => [fileHandle("New.md")];
    vi.spyOn(c.editor, "save").mockResolvedValue(false);
    await c[method]();
    expect(c.project.currentPath).toBe("A.md");
    delete globalThis.showDirectoryPicker;
    delete globalThis.showOpenFilePicker;
  });
  it.each(
    ["openFile", "openDirectory"].flatMap((method) =>
      ["AbortError", "SecurityError", "NotAllowedError", "Other"].map((name) => [method, name]),
    ),
  )("handles %s failure %s", async (method, name) => {
    c.apiOk = true;
    const picker = async () => {
      throw new DOMException("failed", name);
    };
    globalThis.showDirectoryPicker = picker;
    globalThis.showOpenFilePicker = picker;
    await c[method]();
    expect(c.toastTarget.hidden).toBe(name === "AbortError");
    delete globalThis.showDirectoryPicker;
    delete globalThis.showOpenFilePicker;
  });
  it("reads and writes IndexedDB settings", async () => {
    await c.workspaceSetting({ path: "A.md" });
    expect(await c.workspaceSetting()).toEqual({ path: "A.md" });
  });
  it("reports database opening and transaction failures", async () => {
    const original = indexedDB.open.bind(indexedDB);
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const request = {
        error: new Error("open"),
        addEventListener: (_type, handler) => queueMicrotask(handler),
      };
      return request;
    });
    await expect(c.workspaceSetting()).rejects.toThrow("open");
    indexedDB.open.mockImplementation(() => {
      const transaction = {
        objectStore: () => ({ get: () => ({}) }),
        error: new Error("tx"),
        addEventListener: (_type, handler) => queueMicrotask(handler),
      };
      const database = {
        transaction: () => transaction,
        close: vi.fn(),
      };
      const request = { result: database, addEventListener: vi.fn() };
      queueMicrotask(() => request.onsuccess());
      return request;
    });
    await expect(c.workspaceSetting()).rejects.toThrow("tx");
    indexedDB.open.mockImplementation(() => {
      const transaction = {
        objectStore: () => ({ get: () => ({}) }),
        error: new Error("abort"),
        addEventListener: (eventValue, callback) => queueMicrotask(callback),
      };
      const database = {
        transaction: () => transaction,
        close: vi.fn(),
      };
      const request = { result: database, addEventListener: vi.fn() };
      queueMicrotask(() => request.onsuccess());
      return request;
    });
    await expect(c.workspaceSetting()).rejects.toThrow("abort");
    indexedDB.open.mockImplementation(original);
  });
  it("loads recent workspace only when permitted and empty", async () => {
    const setting = vi.spyOn(c, "workspaceSetting").mockResolvedValue({ handle: fileHandle("Recent.md") });
    await c.loadRecentWorkspace();
    expect(setting).not.toHaveBeenCalled();
    c.apiOk = true;
    await c.loadRecentWorkspace();
    expect(c.resumeButtonTarget.textContent).toContain("Recent.md");
    c.project.nodes.set("present", {});
    await c.loadRecentWorkspace();
    c.project.nodes.clear();
    setting.mockResolvedValue({});
    await c.loadRecentWorkspace();
    setting.mockRejectedValue(new Error("storage disabled"));
    await c.loadRecentWorkspace();
  });
  it("skips remembering unsuitable handles and tolerates storage failures", async () => {
    c.apiOk = true;
    c.rememberWorkspace();
    c.project.fileHandle = {};
    c.rememberWorkspace();
    c.project.fileHandle = fileHandle("A.md");
    vi.spyOn(c, "workspaceSetting").mockRejectedValue(new Error("full"));
    c.rememberWorkspace();
    await Promise.resolve();
    expect(c.recentWorkspace.handle.name).toBe("A.md");
  });
  it("resumes directory, its selected path and single files", async () => {
    for (const [handle, path] of [
      [directory("Notes", [fileHandle("A.md", "text")]), "A.md"],
      [fileHandle("B.md", "single"), undefined],
      [directory("Empty"), "missing"],
    ]) {
      c.recentWorkspace = { handle, path };
      // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
      await c.resumeWorkspace();
      expect(c.rootNameTarget.textContent).toBe(handle.name);
      expect(c.statusTextTarget.textContent).toBe("Проект открыт");
    }
  });
  it("handles busy, absent, denied, failed save and failed resume", async () => {
    await c.resumeWorkspace();
    c.project.operationBusy = true;
    c.recentWorkspace = {};
    await c.resumeWorkspace();
    c.project.operationBusy = false;
    c.recentWorkspace = { handle: { requestPermission: async () => "denied" } };
    await c.resumeWorkspace();
    expect(c.toastTarget.textContent).toContain("Разрешите");
    await notes();
    await c.openNode("A.md");
    c.recentWorkspace = { handle: fileHandle("Other.md") };
    vi.spyOn(c.editor, "save").mockResolvedValue(false);
    await c.resumeWorkspace();
    expect(c.project.currentPath).toBe("A.md");
    c.recentWorkspace = {
      handle: {
        requestPermission: async () => {
          throw new Error("gone");
        },
      },
    };
    await c.resumeWorkspace();
    expect(c.toastTarget.textContent).toContain("Не удалось открыть");
  });
  it("scans empty and inaccessible nested folders but propagates root errors", async () => {
    const broken = {
      kind: "directory",
      name: "Broken",
      async *values() {
        yield* [];
        throw new Error("denied");
      },
    };
    await c.project.scanDirectory(directory("Root", [broken]), "");
    expect(c.project.nodes.has("Broken")).toBe(true);
    await expect(c.project.scanDirectory(broken, "")).rejects.toThrow("denied");
  });
});
describe("Rename, move and delete", () => {
  it("opens rename and delete dialogs with appropriate descriptions", async () => {
    await notes();
    for (const path of ["A.md", "Folder", "Empty"]) {
      c.tree.contextPath = path;
      c.tree.renameSelected();
      expect(c.tree.actionInputTarget.hidden).toBe(false);
      c.tree.cancelAction();
      c.tree.deleteSelected();
      expect(c.tree.actionInputTarget.hidden).toBe(true);
      expect(c.tree.actionDescriptionTarget.textContent).toContain("с диска");
      c.tree.cancelAction();
    }
    c.project.dirHandle = null;
    c.tree.deleteSelected();
    expect(c.tree.actionDescriptionTarget.textContent).toContain("останутся");
    c.project.operationBusy = true;
    c.tree.cancelAction();
    expect(c.tree.actionDialogTarget.open).toBe(true);
  });
  it("ignores absent and busy actions and blocks standalone disk file operations", async () => {
    c.tree.startAction("rename");
    c.project.nodes.set("A.md", { kind: "file", name: "A.md", handle: fileHandle("A.md") });
    c.tree.contextPath = "A.md";
    c.project.operationBusy = true;
    c.tree.startAction("rename");
    expect(c.tree.actionDialogTarget.open).toBe(false);
    c.project.operationBusy = false;
    c.tree.startAction("rename");
    expect(c.toastTarget.textContent).toContain("содержащую файл папку");
  });
  it("renames extensionless uploaded files and validates names", async () => {
    c.project.nodes.set("note", {
      kind: "file",
      name: "note",
      parentPath: "",
      handle: { getFile: async () => new File(["a"], "note") },
    });
    c.tree.contextPath = "note";
    c.tree.renameSelected();
    for (const name of ["", ".", "..", "a/b", String.raw`a\b`, "a\u{1}"]) {
      c.tree.actionInputTarget.value = name;
      // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
      await c.tree.submitAction(event());
      expect(c.tree.actionErrorTarget.textContent).toContain("Введите имя");
    }
    c.tree.actionInputTarget.value = "new";
    await c.tree.submitAction(event());
    expect(c.project.nodes.has("new")).toBe(true);
    expect(c.rootNameTarget.textContent).toBe("new");
  });
  it("submits deletion and ignores busy, absent or removed pending actions", async () => {
    await notes();
    await c.tree.submitAction(event());
    c.project.operationBusy = true;
    c.tree.pendingAction = {};
    await c.tree.submitAction(event());
    c.project.operationBusy = false;
    c.tree.pendingAction = { path: "gone" };
    c.tree.actionDialogTarget.showModal();
    await c.tree.submitAction(event());
    expect(c.tree.actionDialogTarget.open).toBe(false);
    c.tree.contextPath = "A.md";
    c.tree.deleteSelected();
    await c.tree.submitAction(event());
    expect(c.project.nodes.has("A.md")).toBe(false);
  });
  it("moves local files, recursively moves folders and updates open editor", async () => {
    await notes();
    await c.openNode("Folder/B.md");
    c.tree.expanded.add("Folder");
    await c.moveNode("Folder", "", { requestedName: "Renamed" });
    expect(c.project.currentPath).toBe("Renamed/B.md");
    expect(c.editor.editorSession.handle).toBe(c.project.fileHandle);
    expect(c.project.nodes.has("Renamed/B.md")).toBe(true);
    await c.moveNode("A.md", "Renamed");
    expect(c.project.nodes.has("Renamed/A.md")).toBe(true);
  });
  it("moves uploaded folders and remaps previews without changing original files", async () => {
    await notes();
    c.project.dirHandle = null;
    for (const node of c.project.nodes.values()) {
      if (node.handle) {
        delete node.handle.createWritable;
      }
    }
    await c.openNode("Folder/B.md");
    c.editor.showObjectPreview(new File(["pdf"], "B.pdf"), "application/pdf");
    await c.moveNode("Folder", "", { requestedName: "Moved" });
    expect(c.project.currentPath).toBe("Moved/B.md");
    expect(c.editor.editorTarget.querySelector("object").getAttribute("aria-label")).toContain("B.md");
    c.tree.expanded.add("unrelated");
    await c.moveNode("A.md", "Moved");
    expect(c.tree.expanded.has("unrelated")).toBe(true);
  });
  it("handles a removed preview object during a move", async () => {
    await notes();
    c.project.dirHandle = null;
    for (const node of c.project.nodes.values()) {
      if (node.handle) {
        delete node.handle.createWritable;
      }
    }
    await c.openNode("A.md");
    c.editor.previewFile = new File(["pdf"], "A.pdf");
    await c.moveNode("A.md", "", { requestedName: "New.md" });
    expect(c.project.currentPath).toBe("New.md");
  });
  it("renames collisions automatically", async () => {
    await notes();
    await c.moveNode("Folder/B.md", "", { requestedName: "A.md" });
    expect(c.project.nodes.has("A (1).md")).toBe(true);
    expect(c.toastTarget.textContent).toContain("Имя уже занято");
  });
  it("ignores unavailable, invalid and unchanged destinations", async () => {
    await notes();
    await c.moveNode("none", "");
    await c.moveNode("Folder", "Folder");
    expect(c.toastTarget.textContent).toContain("внутрь");
    await expect(
      c.moveNode("Folder", "Folder/Child", { requestedName: null, shouldPropagate: true }),
    ).rejects.toThrow("внутрь");
    await c.moveNode("A.md", "A.md");
    await c.moveNode("A.md", "missing");
    await c.moveNode("A.md", "");
    await c.moveNode("A.md", "", { requestedName: "A.md" });
    c.project.operationBusy = true;
    await c.moveNode("A.md", "Folder");
    await expect(
      c.moveNode("A.md", "Folder", { requestedName: null, shouldPropagate: true }),
    ).rejects.toThrow("Дождитесь");
  });
  it("blocks disk moves without parent access or after failed save", async () => {
    await notes();
    await c.openNode("A.md");
    c.project.dirHandle = null;
    await c.moveNode("A.md", "", { requestedName: "New.md" });
    expect(c.toastTarget.textContent).toContain("содержащую файл");
    c.project.dirHandle = directory("Notes");
    vi.spyOn(c.editor, "save").mockResolvedValue(false);
    await c.moveNode("A.md", "", { requestedName: "New.md" });
    expect(c.toastTarget.textContent).toContain("Не удалось сохранить");
    expect(c.project.operationBusy).toBe(false);
  });
  it("rolls back an unfinished destination after a failed copy", async () => {
    await notes();
    const root = c.project.dirHandle;
    const get = root.getFileHandle;
    root.getFileHandle = async (...args) => {
      const h = await get(...args);
      h.createWritable = async () => {
        throw new Error("disk full");
      };
      return h;
    };
    await c.moveNode("A.md", "", { requestedName: "New.md" });
    expect(root.children.has("New.md")).toBe(false);
    expect(root.children.has("A.md")).toBe(true);
    expect(c.project.nodes.has("A.md")).toBe(true);
  });
  it("reports cleanup failure and propagates operation errors when requested", async () => {
    await notes();
    vi.spyOn(c.project, "copyHandle").mockImplementation(async (s, p, options) => {
      options.onCreated();
      throw new Error("copy");
    });
    c.project.dirHandle.removeEntry = async () => {
      throw new Error("cleanup");
    };
    await c.moveNode("A.md", "", { requestedName: "New.md" });
    expect(c.project.nodes.has("A.md")).toBe(true);
    await expect(c.moveNode("A.md", "", { requestedName: "New.md", shouldPropagate: true })).rejects.toThrow(
      "copy",
    );
  });
  it("aborts failed copying writes, including failed aborts", async () => {
    const source = fileHandle("A.md", "a");
    for (const abortFails of [false, true]) {
      const parent = directory("Root");
      parent.getFileHandle = async () => ({
        createWritable: async () => ({
          write: async () => {
            throw new Error("write");
          },
          abort: async () => {
            if (abortFails) {
              throw new Error("abort");
            }
          },
        }),
      });
      // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
      await expect(c.project.copyHandle(source, parent, { name: "New.md" })).rejects.toThrow("write");
    }
  });
  it("deletes selected directory contents and leaves unrelated files", async () => {
    await notes();
    await c.openNode("Folder/B.md");
    await c.removeNode("Folder");
    expect(c.project.currentPath).toBeNull();
    expect(c.project.nodes.has("A.md")).toBe(true);
    expect(c.project.nodes.has("Folder/B.md")).toBe(false);
    await c.removeNode("A.md");
    expect(c.statusTextTarget.textContent).toBe("Удалено с диска");
  });
  it("deletes uploaded files, handles absent nodes and preserves failed saves", async () => {
    await notes();
    await c.removeNode("none");
    c.project.operationBusy = true;
    await expect(c.removeNode("A.md")).rejects.toThrow("Дождитесь");
    c.project.operationBusy = false;
    vi.spyOn(c.editor, "save").mockResolvedValue(false);
    await expect(c.removeNode("A.md")).rejects.toThrow("Не удалось сохранить");
    expect(c.project.nodes.has("A.md")).toBe(true);
    c.project.dirHandle = null;
    await c.removeNode("Folder");
    expect(c.statusTextTarget.textContent).toBe("Удалено из проекта");
  });
});
