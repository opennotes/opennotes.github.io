async page => {
  await page.route('**/edit.html', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('Application.start().register("workspace", WorkspaceController);', 'window.notesApplication=Application.start();window.notesApplication.register("workspace", WorkspaceController);') });
  });
  await page.goto('http://127.0.0.1:4173/edit.html');
  await page.waitForFunction(() => document.querySelector('.app')?.dataset.ready === 'true');
  return page.evaluate(async () => {
    const c = window.notesApplication.getControllerForElementAndIdentifier(document.querySelector('[data-controller="workspace"]'), 'workspace');
    c.apiOk = false;
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const reads = {};
    const handle = (name, content, type = '') => {
      let modified = 1;
      return { kind: 'file', name, change(value) { content = value; modified++; }, async getFile() {
        const file = new File([content], name, { type, lastModified: modified });
        for (const method of ['text', 'arrayBuffer']) {
          const read = file[method].bind(file);
          file[method] = async () => { reads[name] = (reads[name] || 0) + 1; await sleep(100); return read(); };
        }
        return file;
      } };
    };
    const text = handle('A.md', '# Alpha');
    const picture = handle('image.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml');
    const hidden = handle('hidden.md', 'hidden');
    const nested = handle('nested.md', 'nested');
    c.nodes = new Map([
      ['A.md', { handle: text, kind: 'file', name: text.name, parentPath: '' }],
      ['image.svg', { handle: picture, kind: 'file', name: picture.name, parentPath: '' }],
      ['.git', { kind: 'directory', name: '.git', parentPath: '' }],
      ['.git/hidden.md', { handle: hidden, kind: 'file', name: hidden.name, parentPath: '.git' }],
      ['Folder', { kind: 'directory', name: 'Folder', parentPath: '' }],
      ['Folder/nested.md', { handle: nested, kind: 'file', name: nested.name, parentPath: 'Folder' }],
    ]);
    c.prepareTree(); c.renderTree();
    await c.openNode('A.md');
    check(reads['A.md'] === 1, 'Foreground duplicated background read');
    await sleep(130);
    check(!reads['nested.md'] && !reads['hidden.md'], 'Read collapsed or hidden files');
    await c.openNode('image.svg'); await c.openNode('A.md');
    const start = performance.now(); await c.openNode('image.svg');
    check(reads['image.svg'] === 1, 'Image read from disk on every switch');
    check(performance.now() - start < 100, 'Cached image waited for disk');
    picture.change('<svg xmlns="http://www.w3.org/2000/svg"><title>Changed</title></svg>');
    await c.openNode('A.md'); await c.openNode('image.svg');
    check(reads['image.svg'] === 2 && (await c.previewFile.text()).includes('Changed'), 'Image cache hid external change');
    c.toggleExpand('Folder'); await sleep(130);
    check(reads['nested.md'] === 1, 'Expanded folder was not prefetched');
    await c.openNode('Folder/nested.md'); check(reads['nested.md'] === 1, 'Prefetched text re-read');
    c.closeEditor();
    return { sharedReads: true, cachedImages: true, externalChanges: true, revealedFilesOnly: true };
  });
}
