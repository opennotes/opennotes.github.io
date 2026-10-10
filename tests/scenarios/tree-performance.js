export default async function verifyTreePerformance(page) {
  await page.goto("/edit.html");
  await page.waitForFunction(() => document.querySelector(".app")?.dataset.ready === "true");
  await page.evaluate(async () => {
    const awaitedResult1 = await import("/js/entries/editor.js");
    globalThis.notesApplication = awaitedResult1.application;
  });
  return await page.evaluate(async () => {
    const c = globalThis.notesApplication.getControllerForElementAndIdentifier(
      document.querySelector('[data-controller~="workspace"]'),
      "workspace",
    );
    c.dismissBanner();
    c.apiOk = false;
    const root = await navigator.storage.getDirectory();
    const folderHandle = await root.getDirectoryHandle(`tree-perf-${Date.now()}`, { create: true });
    const sub = await folderHandle.getDirectoryHandle("Folder", { create: true });
    const a = await folderHandle.getFileHandle("A.md", { create: true });
    const b = await sub.getFileHandle("B.md", { create: true });
    const write = async (h, text) => {
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
    };
    await write(a, "# Alpha");
    await write(b, "# Beta");
    c.project.nodes.clear();
    c.project.dirHandle = folderHandle;
    c.project.workspaceIsDirectory = true;
    await c.project.scanDirectory(folderHandle, "");
    c.prepareTree();
    c.tree.renderTree();
    const check = (ok, message) => {
      if (!ok) {
        throw new Error(message);
      }
    };
    check(
      c.project.nodes.has("Folder/B.md") && !c.tree.treeRows.has("Folder/B.md"),
      "Collapsed hierarchy incorrect",
    );
    await c.openNode("A.md");
    const view = c.editor.view;
    await c.openNode("Folder/B.md");
    check(
      c.tree.treeRows.has("Folder/B.md") && c.editor.view === view,
      "Folder reveal or editor reuse failed",
    );
    const nestedRow = c.tree.treeRows.get("Folder/B.md");
    await c.openNode("A.md");
    check(c.tree.treeRows.get("Folder/B.md") === nestedRow, "Tree rebuilt during switching");
    check(
      c.tree.treeRows.get("A.md").getAttribute("aria-selected") === "true" &&
        nestedRow.getAttribute("aria-selected") === "false",
      "Selection incorrect",
    );
    const headerRows = () => c.editor.editorTarget.querySelectorAll(".cm-md-heading-1").length;
    check(headerRows() > 0, "Heading styling lost");
    await write(b, "# Changed elsewhere");
    await c.openNode("Folder/B.md");
    check(c.editor.view.state.doc.toString() === "# Changed elsewhere", "External change hidden by cache");
    await c.moveNode("Folder/B.md", "", { requestedName: "Moved.md" });
    check(
      c.tree.treeRows.has("Moved.md") && !c.tree.treeRows.has("Folder/B.md"),
      "Move did not refresh tree",
    );
    check(c.project.currentPath === "Moved.md", "Current moved file lost");
    await c.removeNode("Moved.md");
    check(!c.tree.treeRows.has("Moved.md") && c.project.nodes.has("A.md"), "Delete did not refresh tree");
    c.editor.closeEditor();
    await root.removeEntry(folderHandle.name, { recursive: true });
    return {
      reuse: true,
      stableRows: true,
      externalChanges: true,
      moveAndDelete: true,
    };
  });
}
