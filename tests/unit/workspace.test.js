import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";

import { mount, fileHandle, directory, project } from "../support/workspace.js";

let c, app;
beforeEach(async () => {
  ({ c, app } = await mount());
});
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search");
  app.stop();
});
const event = (extra = {}) => ({ preventDefault: vi.fn(), ...extra });
async function open(content = "Alpha") {
  await project(c, directory("Notes", [fileHandle("A.md", content), fileHandle("B.md", "Beta")]));
  await c.openNode("A.md");
}
describe("Workspace UI", () => {
  it("initializes fallback, dismisses it and preserves the dismissal", () => {
    expect(c.bannerTarget.textContent).toContain("Автосохранение");
    c.dismissBanner();
    c.enableFallback("permission");
    expect(c.bannerTarget.classList.contains("visible")).toBe(false);
    expect(document.activeElement).toBe(c.openButtonTarget);
  });
  it("supports mobile dismissal", () => {
    matchMedia.mockReturnValueOnce({ matches: true });
    c.dismissBanner();
    expect(document.activeElement).toBe(c.appTarget.querySelector(".mobile-bar button"));
  });
  it.each(["unsupported", "insecure", "permission"])("explains %s failures", (reason) => {
    c.enableFallback(reason);
    expect(c.bannerTarget.classList.contains("visible")).toBe(true);
  });
  it("uses unsupported reason on secure pages", () => {
    vi.stubGlobal("isSecureContext", true);
    c.enableFallback();
    expect(c.bannerTarget.textContent).toContain("Браузер не поддерживает");
    vi.stubGlobal("isSecureContext", false);
  });
  it("toggles sidebar and open menu", () => {
    c.toggleSidebar();
    expect(c.sidebarTarget.classList.contains("open")).toBe(true);
    c.toggleSidebar();
    c.toggleOpenMenu();
    expect(c.openMenuTarget.hidden).toBe(false);
    c.toggleOpenMenu();
    expect(c.openMenuTarget.hidden).toBe(true);
  });
  it("closes menus on outside click and leaves their own clicks alone", () => {
    c.toggleOpenMenu();
    c.tree.contextMenuTarget.hidden = false;
    c._onClick({ target: document.body });
    expect(c.openMenuTarget.hidden).toBe(true);
    expect(c.tree.contextMenuTarget.hidden).toBe(true);
    c.toggleOpenMenu();
    c._onClick({ target: c.openButtonTarget });
    expect(c.openMenuTarget.hidden).toBe(false);
    c._onClick({ target: c.tree.contextMenuTarget });
  });
  it("opens search on double Shift and closes all dialogs on Escape", () => {
    c.search._onKey({ key: "Shift" });
    c.search._onKey({ key: "Shift" });
    expect(c.search.searchDialogTarget.open).toBe(true);
    c.tree.actionDialogTarget.showModal();
    const keyboardEvent = event({ key: "Escape" });
    c.search._onKey(keyboardEvent);
    c._onKey(keyboardEvent);
    expect(c.search.searchDialogTarget.open).toBe(false);
    expect(c.tree.actionDialogTarget.open).toBe(false);
    expect(keyboardEvent.preventDefault).toHaveBeenCalled();
    c.search._onKey({ key: "x" });
    c.search._onKey({ key: "Shift", repeat: true });
    c.search._onKey({ key: "Shift", ctrlKey: true });
    c.search._onKey({ key: "Shift", metaKey: true });
    c.search._onKey({ key: "Shift", altKey: true });
    c.project.operationBusy = true;
    c.tree.actionDialogTarget.showModal();
    c._onKey(event({ key: "Escape" }));
    expect(c.tree.actionDialogTarget.open).toBe(true);
  });
  it("prevents cancel during a file operation", () => {
    c.project.operationBusy = true;
    const keyboardEvent = new Event("cancel", { cancelable: true });
    c.tree.actionDialogTarget.dispatchEvent(keyboardEvent);
    expect(keyboardEvent.defaultPrevented).toBe(true);
    c.project.operationBusy = false;
    const allowed = new Event("cancel", { cancelable: true });
    c.tree.actionDialogTarget.dispatchEvent(allowed);
    expect(allowed.defaultPrevented).toBe(false);
  });
  it("shows and hides accessible toasts", () => {
    vi.useFakeTimers();
    c.showToast(null);
    expect(c.toastTarget.hidden).toBe(true);
    c.showToast(" notice ", 10);
    expect(c.toastTarget.textContent).toBe("notice");
    vi.advanceTimersByTime(10);
    expect(c.toastTarget.hidden).toBe(true);
  });
  it("formats errors", () => {
    expect(c.errMsg({ name: "NotAllowedError" })).toContain("разрешения");
    expect(c.errMsg({ name: "SecurityError" })).toContain("HTTPS");
    expect(c.errMsg({ message: "Oops" })).toBe("Oops");
    expect(c.errMsg({})).toBe("Ошибка");
  });
  it("downloads only an open file", async () => {
    vi.useFakeTimers();
    c.editor.downloadFile();
    vi.useRealTimers();
    await open();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    c.editor.downloadFile();
    expect(click).toHaveBeenCalled();
    expect(c.statusTextTarget.textContent).toContain("Скачивание");
    vi.useFakeTimers();
    c.editor.downloadFile();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it("downloads previews and handles a missing node label", async () => {
    await open();
    c.editor.showObjectPreview(new File(["png"], "A.png", { type: "image/png" }), "image/png");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    c.editor.downloadFile();
    c.project.nodes.delete(c.project.currentPath);
    c.editor.downloadFile();
    expect(c.statusTextTarget.textContent).toContain("Скачивание");
  });
  it("imports a file and clears its picker", async () => {
    const input = { files: [new File(["# Import"], "note.md")], value: "x" };
    await c.importFiles({ target: input });
    expect(c.editor.view.state.doc.toString()).toBe("# Import");
    expect(input.value).toBe("");
  });
  it("imports directories as collapsed hierarchy", async () => {
    const files = ["P/Folder/A.md", "P/Folder/B.md", "P/Z.md", "P/Other/C.md"].map((path) => {
      const f = new File(["text"], path.split("/").at(-1));
      Object.defineProperty(f, "webkitRelativePath", { value: path });
      return f;
    });
    Object.defineProperty(c.directoryInputTarget, "files", { value: files, configurable: true });
    await c.importFiles({ target: c.directoryInputTarget });
    expect(c.project.nodes.has("Folder/A.md")).toBe(true);
    expect(c.tree.expanded.size).toBe(0);
    expect(c.project.currentPath).toBeNull();
  });
  it("ignores empty and busy imports and reports read failures", async () => {
    await c.importFiles({ target: { files: [] } });
    c.project.operationBusy = true;
    await c.importFiles({});
    c.project.operationBusy = false;
    vi.spyOn(c, "prepareTree").mockImplementation(() => {
      throw new Error("broken");
    });
    const input = { files: [new File(["a"], "A.md")], value: "x" };
    await c.importFiles({ target: input });
    expect(c.toastTarget.textContent).toBe("broken");
    expect(input.value).toBe("");
  });
});
describe("Opening and caching", () => {
  it("opens, switches and reuses editor and tree rows", async () => {
    await open("# Alpha");
    const view = c.editor.view,
      row = c.tree.treeRows.get("A.md");
    await c.openNode("B.md");
    expect(c.editor.view).toBe(view);
    await c.openNode("A.md");
    expect(c.tree.treeRows.get("A.md")).toBe(row);
    expect(c.editor.view.state.doc.toString()).toBe("# Alpha");
    expect(row.getAttribute("aria-selected")).toBe("true");
  });
  it("reveals ancestors of nested files", async () => {
    await project(
      c,
      directory("Notes", [directory("Folder", [directory("Deep", [fileHandle("N.md", "nested")])])]),
    );
    await c.openNode("Folder/Deep/N.md");
    expect([...c.tree.expanded]).toEqual(["Folder/Deep", "Folder"]);
    expect(c.editor.pathLabelTarget.textContent).toBe("Folder/Deep/N.md");
  });
  it("ignores folders, missing files, busy and repeated selections", async () => {
    await open();
    const read = vi.spyOn(c.reader, "readNode");
    await c.openNode("A.md");
    await c.openNode("none");
    c.project.nodes.set("Folder", { kind: "directory" });
    await c.openNode("Folder");
    c.project.operationBusy = true;
    await c.openNode("B.md");
    expect(read).not.toHaveBeenCalled();
  });
  it("preserves current file when saving before switching fails", async () => {
    await open();
    vi.spyOn(c.editor, "save").mockResolvedValue(false);
    await c.openNode("B.md");
    expect(c.project.currentPath).toBe("A.md");
  });
  it("ignores stale reads and stale errors", async () => {
    await open();
    vi.spyOn(c.reader, "readNode").mockImplementation(async () => {
      c.openVersion++;
      return {
        file: new File(["x"], "B.md"),
        type: null,
        text: "x",
      };
    });
    await c.openNode("B.md");
    expect(c.project.currentPath).toBe("A.md");
    c.reader.readNode.mockImplementation(async () => {
      c.openVersion++;
      throw new Error("late");
    });
    await c.openNode("B.md");
    expect(c.toastTarget.hidden).toBe(true);
  });
  it("ignores removed nodes and operations that start during reads", async () => {
    await open();
    const native = c.reader.readNode.bind(c);
    vi.spyOn(c.reader, "readNode").mockImplementation(async (node) => {
      const r = await native(node);
      c.project.nodes.delete("B.md");
      return r;
    });
    await c.openNode("B.md");
    expect(c.project.currentPath).toBe("A.md");
    c.reader.readNode.mockImplementation(async (node) => {
      c.project.operationBusy = true;
      return native(node);
    });
    c.project.nodes.set("B.md", { kind: "file", handle: fileHandle("B.md"), parentPath: "", name: "B.md" });
    await c.openNode("B.md");
    expect(c.project.currentPath).toBe("A.md");
  });
  it("ignores a selection superseded during saving", async () => {
    await open();
    vi.spyOn(c.editor, "save").mockImplementation(async () => {
      c.openVersion++;
      return true;
    });
    await c.openNode("B.md");
    expect(c.project.currentPath).toBe("A.md");
  });
  it("reports current read errors", async () => {
    await open();
    vi.spyOn(c.reader, "readNode").mockRejectedValue(new Error("Read failed"));
    await c.openNode("B.md");
    expect(c.statusTextTarget.textContent).toBe("Ошибка чтения");
    expect(c.toastTarget.textContent).toBe("Read failed");
  });
  it.each([
    ["a.pdf", "", "application/pdf"],
    ["A.PNG", "", "image/png"],
    ["unknown", "image/custom", "image/custom"],
    ["unknown", "application/pdf", "application/pdf"],
    ["a.md", "", ""],
    ["unknown", "text/plain", ""],
  ])("detects %s preview format", (name, type, expected) => {
    expect(c.reader.previewType({ name, type })).toBe(expected || null);
  });
  it("uses memory previews and invalidates changed images", async () => {
    const handle = fileHandle("A.png", "one", "image/png");
    const node = { handle };
    const one = await c.reader.readNode(node);
    const two = await c.reader.readNode(node);
    expect(two.file).toBe(one.file);
    handle.change("changed");
    const three = await c.reader.readNode(node);
    expect(await three.file.text()).toBe("changed");
  });
  it("does not preload large or streamed files", async () => {
    const large = { handle: fileHandle("large.md", "x".repeat(2 * 1024 * 1024 + 1)) };
    expect(await c.reader.readNode(large, null, true)).toBeNull();
    expect(await c.reader.readNode({ handle: fileHandle("A.mp4", "video") }, null, true)).toBeNull();
    const awaitedResult1 = await c.reader.readNode({
      handle: fileHandle("A.png", "x".repeat(8 * 1024 * 1024 + 1)),
    });
    expect(awaitedResult1.file.size).toBeGreaterThan(8 * 1024 * 1024);
  });
  it("reads fallback edits and binary text from cache", async () => {
    for (const text of ["changed", "x\0x"]) {
      const node = { handle: fileHandle("A.md", "disk"), text };
      // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
      const awaitedResult2 = await c.reader.readNode(node);
      expect(awaitedResult2.text).toBe(text);
    }
    const node = { handle: fileHandle("binary", "x\0x") };
    const awaitedResult3 = await c.reader.readNode(node);
    expect(awaitedResult3.type).toBe("application/octet-stream");
    const awaitedResult4 = await c.reader.readNode(node);
    expect(awaitedResult4.type).toBe("application/octet-stream");
    const typed = { handle: fileHandle("bin", "x\0x", "custom/type") };
    await c.reader.readNode(typed);
    const awaitedResult5 = await c.reader.readNode(typed);
    expect(awaitedResult5.type).toBe("custom/type");
  });
  it("shares simultaneous reads", async () => {
    const h = fileHandle("A.md", "shared");
    const get = h.getFile;
    let release;
    h.getFile = async () => {
      const f = await get();
      f.text = () =>
        new Promise((resolve) => {
          release = () => resolve("shared");
        });
      return f;
    };
    const node = { handle: h };
    const first = c.reader.readNode(node);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const second = c.reader.readNode(node);
    release();
    const awaitedResult6 = await first;
    expect(awaitedResult6.text).toBe("shared");
    const awaitedResult7 = await second;
    expect(awaitedResult7.text).toBe("shared");
  });
  it("skips background results from an old project", async () => {
    const h = fileHandle("A.md", "old");
    h.getFile = async () => {
      c.project.projectVersion++;
      return new File(["old"], "A.md");
    };
    expect(await c.reader.readNode({ handle: h }, null, true)).toBeNull();
  });
  it("does not store an image after changing project", async () => {
    const h = fileHandle("A.png", "png");
    const f = await h.getFile();
    f.arrayBuffer = async () => {
      c.project.projectVersion++;
      return new ArrayBuffer(1);
    };
    await c.reader.readNode({ handle: h }, f);
    expect(c.reader.previewCache.size).toBe(0);
  });
  it("evicts oldest images at the cache limit", async () => {
    for (let index = 0; index < 5; index++) {
      // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
      await c.reader.readNode({ handle: fileHandle(`${index}.png`, new Uint8Array(8 * 1024 * 1024)) });
    }
    expect(c.reader.previewCache.size).toBe(4);
    expect(c.reader.previewCacheBytes).toBe(32 * 1024 * 1024);
  });
  it("ignores background failures and runs the next queued file", async () => {
    const bad = {
      handle: {
        getFile: async () => {
          throw new Error("gone");
        },
      },
    };
    const good = { handle: fileHandle("A.md", "next") };
    c.reader.prefetchQueue = [bad, good];
    c.reader.runPrefetch();
    await vi.waitFor(() => expect(c.reader.prefetchActive).toBe(0));
    expect(good.searchCache.text).toBe("next");
  });
  it("handles a preview with missing MIME type", async () => {
    await open();
    c.editor.showObjectPreview(new File(["x"], "A.png"), "image/png");
    expect(c.editor.editorTarget.querySelector("object").type).toBe("image/png");
    c.editor.resetPreview();
    expect(c.editor.previewUrl).toBeNull();
  });
  it("uses root name or application name when closing", () => {
    c.rootNameTarget.textContent = "—";
    c.editor.closeEditor();
    expect(c.mobileTitleTarget.textContent).toBe("Open Notes");
    c.rootNameTarget.textContent = "Notes";
    c.editor.closeEditor();
    expect(c.mobileTitleTarget.textContent).toBe("Notes");
  });
});
