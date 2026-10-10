async page=>{
 await page.route('**/edit.html',async route=>{
  const response=await route.fetch();
  await route.fulfill({response,body:(await response.text()).replace('Application.start().register("workspace", WorkspaceController);','window.notesApplication=Application.start();window.notesApplication.register("workspace", WorkspaceController);')});
 });
 await page.goto('http://127.0.0.1:4173/edit.html');await page.waitForFunction(()=>document.querySelector('.app')?.dataset.ready==='true');
 return await page.evaluate(async()=>{
  const c=window.notesApplication.getControllerForElementAndIdentifier(document.querySelector('[data-controller="workspace"]'),'workspace');c.dismissBanner();c.apiOk=false;
  const root=await navigator.storage.getDirectory();const dir=await root.getDirectoryHandle('tree-perf-'+Date.now(),{create:true});
  const sub=await dir.getDirectoryHandle('Folder',{create:true});
  const a=await dir.getFileHandle('A.md',{create:true});const b=await sub.getFileHandle('B.md',{create:true});
  const write=async(h,text)=>{const w=await h.createWritable();await w.write(text);await w.close();};await write(a,'# Alpha');await write(b,'# Beta');
  c.nodes.clear();c.dirHandle=dir;c.workspaceIsDirectory=true;
  await c.scanDirectory(dir,'');c.prepareTree();c.renderTree();
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};
  check(c.nodes.has('Folder/B.md')&&!c.treeRows.has('Folder/B.md'),'Collapsed hierarchy incorrect');
  await c.openNode('A.md');const row=c.treeRows.get('A.md');const view=c.view;
  await c.openNode('Folder/B.md');check(c.treeRows.has('Folder/B.md')&&c.view===view,'Folder reveal or editor reuse failed');
  const nestedRow=c.treeRows.get('Folder/B.md');
  await c.openNode('A.md');check(c.treeRows.get('Folder/B.md')===nestedRow,'Tree rebuilt during switching');
  check(c.treeRows.get('A.md').getAttribute('aria-selected')==='true'&&nestedRow.getAttribute('aria-selected')==='false','Selection incorrect');
  const headerRows=()=>c.editorTarget.querySelectorAll('.cm-md-heading-1').length;
  check(headerRows()>0,'Heading styling lost');
  await write(b,'# Changed elsewhere');await c.openNode('Folder/B.md');check(c.view.state.doc.toString()==='# Changed elsewhere','External change hidden by cache');
  await c.moveNode('Folder/B.md','','Moved.md');check(c.treeRows.has('Moved.md')&&!c.treeRows.has('Folder/B.md'),'Move did not refresh tree');
  check(c.currentPath==='Moved.md','Current moved file lost');
  await c.removeNode('Moved.md');check(!c.treeRows.has('Moved.md')&&c.nodes.has('A.md'),'Delete did not refresh tree');
  c.closeEditor();await root.removeEntry(dir.name,{recursive:true});
  return {reuse:true,stableRows:true,externalChanges:true,moveAndDelete:true};
 });
}
