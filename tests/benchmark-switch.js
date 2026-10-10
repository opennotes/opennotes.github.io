async page=>{
 await page.route('**/edit.html',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('Application.start().register("workspace", WorkspaceController);','window.notesApplication=Application.start();window.notesApplication.register("workspace", WorkspaceController);')});});
 await page.goto('http://127.0.0.1:4173/edit.html');await page.waitForFunction(()=>document.querySelector('.app')?.dataset.ready==='true');
 return await page.evaluate(async()=>{
  const c=window.notesApplication.getControllerForElementAndIdentifier(document.querySelector('[data-controller="workspace"]'),'workspace');c.dismissBanner();c.apiOk=false;
  const root=await navigator.storage.getDirectory();const fileHandle=await root.getFileHandle('benchmark-'+Date.now()+'.md',{create:true});const w=await fileHandle.createWritable();await w.write('# Note\n'+ 'A paragraph with **Markdown** and a link.\n'.repeat(250));await w.close();
  c.nodes=new Map();for(let i=0;i<2000;i++){const name='Note-'+i+'.md';c.nodes.set(name,{kind:'file',name,parentPath:'',handle:fileHandle});}c.prepareTree();c.renderTree();
  const timings={tree:[],editor:[]};for(const [method,key]of [['renderTree','tree'],['showEditor','editor']]){const fn=c[method].bind(c);c[method]=(...args)=>{const start=performance.now();const result=fn(...args);timings[key].push(performance.now()-start);return result;};}
  const switches=[];for(let i=0;i<6;i++){const start=performance.now();await c.openNode('Note-'+i+'.md');await new Promise(requestAnimationFrame);switches.push(performance.now()-start);}
  c.closeEditor();await root.removeEntry(fileHandle.name);return {switches: switches.map(Math.round),tree:timings.tree.map(Math.round),editor:timings.editor.map(Math.round)};
 });
}
