(() => {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone && !location.pathname.endsWith('/edit.html')) {
    location.replace(new URL('edit.html?app=1', location.href));
    return;
  }
  const tip = document.querySelector('[data-install-tip]');
  if (tip) tip.hidden = standalone;
  const guide = document.querySelector('[data-install-guide]');
  if (guide && new URLSearchParams(location.search).has('install')) guide.hidden = false;
  let installPrompt;
  const nativeInstall = document.querySelector('[data-native-install]');
  const installButton = document.querySelector('[data-install-app]');
  const installFallback = document.querySelector('[data-install-fallback]');
  const installStatus = document.querySelector('[data-install-status]');
  const setStatus = text => { if (installStatus) installStatus.textContent = text; };
  let useNativeInstall = !!nativeInstall && 'HTMLInstallElement' in window && window.isSecureContext && location.protocol !== 'file:';
  const showLegacyInstall = () => {
    if (installButton) installButton.hidden = !installPrompt;
    if (installFallback) installFallback.hidden = !!installPrompt;
  };
  const fallBackFromNative = (force = false) => {
    if (!useNativeInstall && !force) return;
    useNativeInstall = false;
    // Supported <install> hides its child content, so move the fallback out.
    const replacement = document.createElement('span');
    replacement.append(...nativeInstall.childNodes);
    nativeInstall.replaceWith(replacement);
    showLegacyInstall();
  };
  if (standalone && nativeInstall) nativeInstall.hidden = true;
  if (!standalone && nativeInstall && 'HTMLInstallElement' in window && !useNativeInstall) fallBackFromNative(true);
  if (useNativeInstall) {
    nativeInstall.classList.add('native-install');
    if (installButton) installButton.hidden = true;
    if (installFallback) installFallback.hidden = true;
    nativeInstall.addEventListener('installresult', event => {
      if (event.result === 'success') {
        setStatus('Установка завершена. Open Notes доступно в списке приложений.');
      } else if (event.result === 'aborted') {
        setStatus('Установка не завершена. Вы можете попробовать ещё раз.');
      } else if (['invalid-data', 'invalid_data'].includes(event.result)) {
        fallBackFromNative();
        setStatus('Не удалось подготовить установку. Используйте кнопку или меню браузера.');
      }
    });
    // Older trial versions use promptdismiss and validationstatuschanged.
    nativeInstall.addEventListener('promptdismiss', () => setStatus('Установка отменена. Вы можете попробовать ещё раз.'));
    const checkValidity = () => {
      if (nativeInstall.invalidReason === 'install_data_invalid') {
        fallBackFromNative();
        setStatus('Установка через этот элемент недоступна. Используйте кнопку или меню браузера.');
      }
    };
    nativeInstall.addEventListener('validationstatuschange', checkValidity);
    nativeInstall.addEventListener('validationstatuschanged', checkValidity);
  }
  window.addEventListener('beforeinstallprompt', event => {
    if (!installButton || standalone) return;
    event.preventDefault();
    installPrompt = event;
    if (!useNativeInstall) showLegacyInstall();
  });
  installButton?.addEventListener('click', async () => {
    if (!installPrompt || useNativeInstall) return;
    installButton.disabled = true;
    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      setStatus(outcome === 'accepted' ? 'Open Notes установлено. Открывайте его из Dock или списка приложений.' : 'Установку можно повторить через меню браузера.');
    } catch {
      setStatus('Откройте меню браузера и выберите установку приложения.');
    } finally {
      installPrompt = null;
      installButton.disabled = false;
      showLegacyInstall();
    }
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    if (!useNativeInstall) showLegacyInstall();
    setStatus('Приложение установлено. Следующий запуск — из Dock.');
  });
  if (location.protocol === 'file:') {
    setStatus('Установка доступна, когда Open Notes открыт по адресу сайта. Сейчас вы можете пользоваться редактором в браузере.');
  }
  window.openNotesReady = Promise.resolve();
  if (!('serviceWorker' in navigator) || !window.isSecureContext || location.protocol === 'file:') return;
  const setup = (async () => {
    const registration = await navigator.serviceWorker.register('sw.js', { scope: './' });
    const announceUpdate = () => {
      if (registration.waiting) setStatus('Обновление готово. Оно появится после закрытия всех окон Open Notes и следующего запуска.');
    };
    announceUpdate();
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', announceUpdate);
    });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  })();
  // A slow first download must not prevent the editor from opening online.
  window.openNotesReady = Promise.race([setup, new Promise(resolve => setTimeout(resolve, 10000))]).catch(() => {
    setStatus('Офлайн-режим пока не подготовлен. Подключитесь к сети и откройте приложение ещё раз.');
  });
})();
