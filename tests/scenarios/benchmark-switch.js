export default async function benchmarkSwitch(page) {
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
    const fileHandle = await root.getFileHandle(`benchmark-${Date.now()}.md`, { create: true });
    const w = await fileHandle.createWritable();
    await w.write(`# Note\n${"A paragraph with **Markdown** and a link.\n".repeat(250)}`);
    await w.close();
    c.project.nodes = new Map();
    for (let index = 0; index < 2000; index++) {
      const name = `Note-${index}.md`;
      c.project.nodes.set(name, { kind: "file", name, parentPath: "", handle: fileHandle });
    }
    c.prepareTree();
    c.tree.renderTree();
    const timings = { tree: [], editor: [] };
    for (const [method, key] of [
      ["renderTree", "tree"],
      ["showEditor", "editor"],
    ]) {
      const controller = c[key];
      const function_ = controller[method].bind(controller);
      controller[method] = (...args) => {
        const start = performance.now();
        const result = function_(...args);
        timings[key].push(performance.now() - start);
        return result;
      };
    }
    const switches = [];
    for (let index = 0; index < 6; index++) {
      const start = performance.now();
      // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
      await c.openNode(`Note-${index}.md`);
      // eslint-disable-next-line no-await-in-loop -- Browser interactions and cache checks depend on the preceding step.
      await new Promise(requestAnimationFrame);
      switches.push(performance.now() - start);
    }
    c.editor.closeEditor();
    await root.removeEntry(fileHandle.name);
    return {
      switches: switches.map((value) => Math.round(value)),
      tree: timings.tree.map((value) => Math.round(value)),
      editor: timings.editor.map((value) => Math.round(value)),
    };
  });
}
