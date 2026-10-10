async page => {
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{window.showDirectoryPicker=undefined;window.showOpenFilePicker=undefined;});
 await page.route('**/edit.html',async route=>{
  const response=await route.fetch();
  await route.fulfill({response,body:(await response.text()).replace('Application.start().register("workspace", WorkspaceController);','window.notesApplication=Application.start();window.notesApplication.register("workspace", WorkspaceController);')});
 });
 await page.goto('http://127.0.0.1:4173/edit.html');
 await page.waitForFunction(()=>document.querySelector('.app')?.dataset.ready==='true');
 const banner=page.locator('[data-workspace-target="banner"]');
 if(!(await banner.innerText()).includes('Браузер не поддерживает автосохранение') || (await banner.innerText()).includes('HTTPS')) throw Error('Unsupported API copy is incorrect');
 const before=await page.locator('.main').boundingBox();
 await page.getByRole('button',{name:'Закрыть предупреждение'}).click();
 if(await banner.isVisible())throw Error('Banner did not close');
 const after=await page.locator('.main').boundingBox();
 if(after.height<=before.height || after.y>=before.y)throw Error('Banner space was not reclaimed');
 if(!await page.getByRole('button',{name:'Файлы',exact:true}).evaluate(el=>el===document.activeElement))throw Error('Mobile keyboard focus not restored');
 await page.locator('[data-workspace-target="fileInput"]').setInputFiles('tests/fixtures/banner-notes.md');
 await page.getByText('banner-notes.md',{exact:true}).first().click();
 await page.locator('.cm-content').fill('# Mobile note edited');
 if(!await page.locator('[data-workspace-target="download"]').isVisible())throw Error('Download unavailable');
 await page.evaluate(()=>{
  const c=window.notesApplication.getControllerForElementAndIdentifier(document.querySelector('[data-controller="workspace"]'),'workspace');
  c.enableFallback('permission');
  if(!c.bannerTarget.innerText.includes('Доступ к файлам ограничен')||c.bannerTarget.classList.contains('visible'))throw Error('Permission reason or dismissal failed');
 });
 await page.goto('http://127.0.0.1:4173/edit.html');
 await page.waitForFunction(()=>document.querySelector('.app')?.dataset.ready==='true');
 await page.evaluate(()=>{
  const c=window.notesApplication.getControllerForElementAndIdentifier(document.querySelector('[data-controller="workspace"]'),'workspace');
  c.enableFallback('insecure');
  if(!c.bannerTarget.innerText.includes('HTTPS'))throw Error('Insecure context guidance missing');
 });
 await page.screenshot({path:'/tmp/banner-mobile.png'});
 return {unsupportedWithoutHttps:true,closable:true,editorSpaceRestored:true,editable:true,reasonsSeparated:true};
}
