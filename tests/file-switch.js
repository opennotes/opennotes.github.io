async page => {
 await page.route('**/edit.html',async route=>{
  const response=await route.fetch();
  const source=(await response.text()).replace('Application.start().register("workspace", WorkspaceController);','window.notesApplication = Application.start(); window.notesApplication.register("workspace", WorkspaceController);');
  await route.fulfill({response,body:source});
 });
 await page.goto('http://127.0.0.1:4173/edit.html');
 await page.waitForFunction(()=>document.querySelector('.app')?.dataset.ready==='true');
 const result=await page.evaluate(async()=>{
  const c=window.notesApplication.getControllerForElementAndIdentifier(document.querySelector('[data-controller="workspace"]'),'workspace');
  const root=await navigator.storage.getDirectory();
  const dir=await root.getDirectoryHandle('switch-check-'+Date.now(),{create:true});
  const a=await dir.getFileHandle('A.md',{create:true});
  const b=await dir.getFileHandle('B.md',{create:true});
  for(const [h,t] of [[a,'Alpha'],[b,'Beta']]) {const w=await h.createWritable();await w.write(t);await w.close();}
  let writes=0,reads=0,fail=false;
  const handle=h=>({kind:'file',name:h.name,getFile:()=>{reads++;return h.getFile();},createWritable:async()=>{writes++;if(fail)throw Error('Simulated disk failure');await new Promise(r=>setTimeout(r,100));return h.createWritable();}});
  c.nodes=new Map([['A.md',{handle:handle(a),name:'A.md',kind:'file',parentPath:''}],['B.md',{handle:handle(b),name:'B.md',kind:'file',parentPath:''}]]);
  c.workspaceIsDirectory=true;c.dirHandle=dir;c.prepareTree();c.renderTree();
  const statuses=[];const original=c.setStatus.bind(c);c.setStatus=(text,state)=>{statuses.push(text);original(text,state);};
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};
  await c.openNode('A.md');await c.openNode('B.md');await c.openNode('A.md');
  check(writes===0&&!statuses.includes('Сохранение…'),'Unchanged files were written');
  const previousReads=reads;await c.openNode('A.md');check(reads===previousReads,'Selected file reloaded');
  const pendingSwitch=c.openNode('B.md');await c.openNode('A.md');await pendingSwitch;
  check(c.currentPath==='A.md','Latest file selection did not cancel pending switch');
  c.view.dispatch({changes:{from:5,insert:' edited'}});
  const first=c.save();const second=c.save();
  c.view.dispatch({changes:{from:c.view.state.doc.length,insert:' again'}});
  await Promise.all([first,second]);
  check(writes===2,'Repeated saves queued duplicate snapshots');
  check(await (await a.getFile()).text()==='Alpha edited again','Edits during save were lost');
  await c.openNode('B.md');check(writes===2,'Saved file rewritten on switch');
  c.view.dispatch({changes:{from:4,insert:' temporary'}});
  c.view.dispatch({changes:{from:0,to:c.view.state.doc.length,insert:'Beta'}});
  await c.openNode('A.md');check(writes===2,'Reverted changes caused a write');
  c.view.dispatch({changes:{from:c.view.state.doc.length,insert:' keep'}});fail=true;
  await c.openNode('B.md');
  check(c.currentPath==='A.md'&&c.view.state.doc.toString().endsWith(' keep'),'Failed write lost current edits');
  clearTimeout(c.saveTimer);c.closeEditor();
  await root.removeEntry(dir.name,{recursive:true});
  return {unchangedWrites:0,concurrentWrites:2,failedWritePreserved:true};
 });
 return result;
}
