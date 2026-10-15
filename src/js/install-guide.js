/**
 * Recognize iPhones and iPads, including iPads requesting desktop websites.
 *
 * @param {Navigator} navigator - Browser identity hints.
 * @returns {boolean} Whether mobile Apple instructions apply.
 */
function isAppleMobile(navigator) {
  const agent = navigator.userAgent ?? "";

  return /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
}

/**
 * Choose installation instructions from browser and device hints.
 *
 * @param {Navigator} navigator - Browser identity hints.
 * @returns {string} Instruction section identifier.
 */
export function detectInstallBrowser(navigator) {
  const agent = navigator.userAgent ?? "";

  if (isAppleMobile(navigator)) {
    return "ios";
  }

  if (/Android/.test(agent)) {
    return /Firefox\//.test(agent) ? "firefox-android" : "android";
  }

  if (/Edg\//.test(agent)) {
    return "edge";
  }

  if (/Firefox\//.test(agent)) {
    return /Windows/.test(agent) ? "firefox-windows" : "firefox";
  }

  if (/Chrome\/|Chromium\//.test(agent)) {
    return "chrome";
  }

  if (/Safari\//.test(agent) && /Macintosh/.test(agent)) {
    return "safari";
  }

  return "other";
}

/**
 * Name the installation action without suggesting a Mac on mobile devices.
 *
 * @param {Navigator} navigator - Browser identity hints.
 * @returns {string} Installation button label.
 */
export function installButtonLabel(navigator) {
  const isMac = !isAppleMobile(navigator) && /Macintosh|Mac OS X/.test(navigator.userAgent ?? "");

  return isMac ? "Установить на Mac" : "Установить приложение";
}

/**
 * Select device instructions while allowing users to correct browser detection.
 *
 * @param {object} environment - Document and browser dependencies.
 */
export function setupInstallGuide(environment = globalThis) {
  const selector = environment.document.querySelector("[data-install-browser]");

  if (!selector) {
    return;
  }

  const sections = environment.document.querySelectorAll("[data-browser-guide]");

  const update = () => {
    for (const section of sections) {
      section.hidden = section.dataset.browserGuide !== selector.value;
    }
  };

  selector.value = detectInstallBrowser(environment.navigator);
  selector.closest("label").hidden = false;
  selector.addEventListener("change", update);
  update();
}
