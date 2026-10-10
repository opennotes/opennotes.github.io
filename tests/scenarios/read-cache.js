export default async function verifyReadCache(page) {
  await page.goto("/edit.html");
  await page.waitForFunction(() => document.querySelector(".app")?.dataset.ready === "true");
  await page.evaluate(async () => {
    const awaitedResult1 = await import("/js/entries/editor.js");
    globalThis.notesApplication = awaitedResult1.application;
  });
  return page.evaluate(async () => {
    const c = globalThis.notesApplication.getControllerForElementAndIdentifier(
      document.querySelector('[data-controller~="workspace"]'),
      "workspace",
    );
    c.apiOk = false;
    const check = (ok, message) => {
      if (!ok) {
        throw new Error(message);
      }
    };
    const sleep = (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    const reads = {};
    const handle = (name, content, type = "") => {
      let modified = 1;
      let currentContent = content;
      return {
        kind: "file",
        name,
        change(value) {
          currentContent = value;
          modified++;
        },
        async getFile() {
          const file = new File([currentContent], name, { type, lastModified: modified });
          for (const method of ["text", "arrayBuffer"]) {
            const read = file[method].bind(file);
            file[method] = async () => {
              reads[name] = (reads[name] || 0) + 1;
              await sleep(100);
              return read();
            };
          }
          return file;
        },
      };
    };
    const text = handle("A.md", "# Alpha");
    const picture = handle("image.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>', "image/svg+xml");
    const hidden = handle("hidden.md", "hidden");
    const nested = handle("nested.md", "nested");
    c.project.nodes = new Map([
      ["A.md", { handle: text, kind: "file", name: text.name, parentPath: "" }],
      ["image.svg", { handle: picture, kind: "file", name: picture.name, parentPath: "" }],
      [".git", { kind: "directory", name: ".git", parentPath: "" }],
      [".git/hidden.md", { handle: hidden, kind: "file", name: hidden.name, parentPath: ".git" }],
      ["Folder", { kind: "directory", name: "Folder", parentPath: "" }],
      ["Folder/nested.md", { handle: nested, kind: "file", name: nested.name, parentPath: "Folder" }],
    ]);
    c.prepareTree();
    c.tree.renderTree();
    await c.openNode("A.md");
    check(reads["A.md"] === 1, "Foreground duplicated background read");
    await sleep(130);
    check(!reads["nested.md"] && !reads["hidden.md"], "Read collapsed or hidden files");
    await c.openNode("image.svg");
    await c.openNode("A.md");
    const start = performance.now();
    await c.openNode("image.svg");
    check(reads["image.svg"] === 1, "Image read from disk on every switch");
    check(performance.now() - start < 100, "Cached image waited for disk");
    picture.change('<svg xmlns="http://www.w3.org/2000/svg"><title>Changed</title></svg>');
    await c.openNode("A.md");
    await c.openNode("image.svg");
    const awaitedResult2 = await c.editor.previewFile.text();
    check(reads["image.svg"] === 2 && awaitedResult2.includes("Changed"), "Image cache hid external change");
    c.tree.toggleExpand("Folder");
    await sleep(130);
    check(reads["nested.md"] === 1, "Expanded folder was not prefetched");
    await c.openNode("Folder/nested.md");
    check(reads["nested.md"] === 1, "Prefetched text re-read");
    c.editor.closeEditor();
    return {
      sharedReads: true,
      cachedImages: true,
      externalChanges: true,
      revealedFilesOnly: true,
    };
  });
}
