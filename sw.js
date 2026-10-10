const CACHE = 'open-notes-f572c067914f';
const MODULES = {"@hotwired/stimulus": "https://esm.sh/@hotwired/stimulus@3.2.2", "@codemirror/view": "https://esm.sh/@codemirror/view@6.34.1?external=@codemirror/state,@codemirror/view,@codemirror/language,@lezer/highlight", "@codemirror/state": "https://esm.sh/@codemirror/state@6.4.1?external=@codemirror/state,@codemirror/view,@codemirror/language,@lezer/highlight", "@codemirror/commands": "https://esm.sh/@codemirror/commands@6.7.0?external=@codemirror/state,@codemirror/view,@codemirror/language,@lezer/highlight", "@codemirror/language": "https://esm.sh/@codemirror/language@6.10.3?external=@codemirror/state,@codemirror/view,@codemirror/language,@lezer/highlight", "@codemirror/lang-markdown": "https://esm.sh/@codemirror/lang-markdown@6.3.0?external=@codemirror/state,@codemirror/view,@codemirror/language,@lezer/highlight", "@lezer/highlight": "https://esm.sh/@lezer/highlight@1.2.1?external=@codemirror/state,@codemirror/view,@codemirror/language,@lezer/highlight", "ignore": "https://esm.sh/ignore@7.0.5"};
const SHELL = ['index.html', 'edit.html', 'pwa.js', 'manifest.webmanifest', 'assets/app-icon.svg', 'assets/app-icon-180.png', 'assets/app-icon-192.png', 'assets/app-icon-512.png', 'assets/app-icon-maskable.png', 'assets/editor-light.png', 'assets/editor-dark.png'];

async function cacheModules(cache) {
  const visited = new Set();
  const visit = async url => {
    if (visited.has(url)) return;
    visited.add(url);
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) throw Error('Cannot cache module: ' + url);
    const source = await response.clone().text();
    await cache.put(url, response);
    const dependencies = [];
    const pattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g;
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      const dependency = MODULES[specifier] || (/^(https?:|\/|\.)/.test(specifier) ? new URL(specifier, url).href : null);
      if (dependency && new URL(dependency).hostname === 'esm.sh') dependencies.push(visit(dependency));
    }
    await Promise.all(dependencies);
  };
  await Promise.all(Object.values(MODULES).map(visit));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })));
    await cacheModules(cache);
    // Keep the current editor alive; activate updates after its windows close.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('open-notes-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin && url.hostname !== 'esm.sh') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    let match = await cache.match(event.request);
    if (!match && event.request.mode === 'navigate' && url.origin === self.location.origin) {
      const relative = url.pathname.slice(new URL(self.registration.scope).pathname.length);
      if (relative === '' || relative === 'index.html' || relative === 'edit.html') {
        match = await cache.match(new URL(relative === 'edit.html' ? 'edit.html' : 'index.html', self.registration.scope));
      }
    }
    if (match) return match;
    const response = await fetch(event.request);
    if (response.ok && (url.hostname === 'esm.sh' || SHELL.some(path => new URL(path, self.registration.scope).pathname === url.pathname))) {
      await cache.put(event.request, response.clone());
    }
    return response;
  })());
});
