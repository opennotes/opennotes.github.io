export default async function verifyFileSwitch(page) {
  await page.goto("/edit.html");
  await page.waitForFunction(() => document.querySelector(".app")?.dataset.ready === "true");
  await page.evaluate(async () => {
    const awaitedResult1 = await import("/js/entries/editor.js");
    globalThis.notesApplication = awaitedResult1.application;
  });
  const result = await page.evaluate(async () => {
    const c = globalThis.notesApplication.getControllerForElementAndIdentifier(
      document.querySelector('[data-controller~="workspace"]'),
      "workspace",
    );
    const root = await navigator.storage.getDirectory();
    const folderHandle = await root.getDirectoryHandle(`switch-check-${Date.now()}`, { create: true });
    const a = await folderHandle.getFileHandle("A.md", { create: true });
    const b = await folderHandle.getFileHandle("B.md", { create: true });
    for (const [h, t] of [
      [a, "Alpha"],
      [b, "Beta"],
    ]) {
      // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
      const w = await h.createWritable();
      // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
      await w.write(t);
      // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
      await w.close();
    }
    let writes = 0,
      reads = 0,
      isFail = false;
    const handle = (h) => ({
      kind: "file",
      name: h.name,
      getFile: () => {
        reads++;
        return h.getFile();
      },
      createWritable: async () => {
        writes++;
        if (isFail) {
          throw new Error("Simulated disk failure");
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
        return h.createWritable();
      },
    });
    c.project.nodes = new Map([
      ["A.md", { handle: handle(a), name: "A.md", kind: "file", parentPath: "" }],
      ["B.md", { handle: handle(b), name: "B.md", kind: "file", parentPath: "" }],
    ]);
    c.project.workspaceIsDirectory = true;
    c.project.dirHandle = folderHandle;
    c.prepareTree();
    c.tree.renderTree();
    const statuses = [];
    const original = c.setStatus.bind(c);
    c.setStatus = (text, state) => {
      statuses.push(text);
      original(text, state);
    };
    const check = (ok, message) => {
      if (!ok) {
        throw new Error(message);
      }
    };
    await c.openNode("A.md");
    await c.openNode("B.md");
    await c.openNode("A.md");
    check(writes === 0 && !statuses.includes("Сохранение…"), "Unchanged files were written");
    const previousReads = reads;
    await c.openNode("A.md");
    check(reads === previousReads, "Selected file reloaded");
    const pendingSwitch = c.openNode("B.md");
    await c.openNode("A.md");
    await pendingSwitch;
    check(c.project.currentPath === "A.md", "Latest file selection did not cancel pending switch");
    c.editor.view.dispatch({ changes: { from: 5, insert: " edited" } });
    const first = c.editor.save();
    const second = c.editor.save();
    c.editor.view.dispatch({ changes: { from: c.editor.view.state.doc.length, insert: " again" } });
    await Promise.all([first, second]);
    check(writes === 2, "Repeated saves queued duplicate snapshots");
    const awaitedResult2 = await a.getFile();
    check((await awaitedResult2.text()) === "Alpha edited again", "Edits during save were lost");
    await c.openNode("B.md");
    check(writes === 2, "Saved file rewritten on switch");
    c.editor.view.dispatch({ changes: { from: 4, insert: " temporary" } });
    c.editor.view.dispatch({ changes: { from: 0, to: c.editor.view.state.doc.length, insert: "Beta" } });
    await c.openNode("A.md");
    check(writes === 2, "Reverted changes caused a write");
    c.editor.view.dispatch({ changes: { from: c.editor.view.state.doc.length, insert: " keep" } });
    isFail = true;
    await c.openNode("B.md");
    check(
      c.project.currentPath === "A.md" && c.editor.view.state.doc.toString().endsWith(" keep"),
      "Failed write lost current edits",
    );
    clearTimeout(c.editor.saveTimer);
    c.editor.closeEditor();
    await root.removeEntry(folderHandle.name, { recursive: true });
    return {
      unchangedWrites: 0,
      concurrentWrites: 2,
      failedWritePreserved: true,
    };
  });
  return result;
}
