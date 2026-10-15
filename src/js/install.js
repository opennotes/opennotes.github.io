import { installButtonLabel } from "./install-guide.js";

const INSTALL_SELECTORS = {
  guide: "[data-install-guide]",
  "native-install": "[data-native-install]",
  app: "[data-install-app]",
  fallback: "[data-install-fallback]",
  status: "[data-install-status]",
  tip: "[data-install-tip]",
  open: "[data-install-open]",
};

class BrowserInstall {
  /**
   * Create the state needed by this collaborator.
   *
   * @param {object} environment - Browser dependencies supplied by the caller.
   */
  constructor(environment) {
    this.environment = environment;
    this.isStandalone =
      environment.window.matchMedia("(display-mode: standalone)").matches ||
      environment.navigator.standalone === true;
    this.guide = this.find("guide");
    this.nativeInstall = this.find("native-install");
    this.installButton = this.find("app");
    this.installFallback = this.find("fallback");
    this.installStatus = this.find("status");
    this.openEditor = this.find("open");
    this.installed = this.isStandalone;
    this.installAccepted = false;
    this.installPrompt = undefined;
    const hasNativeElement = Boolean(this.nativeInstall) && "HTMLInstallElement" in environment.window;
    const isSecurePage = environment.window.isSecureContext && environment.location.protocol !== "file:";
    this.shouldUseNativeInstall = hasNativeElement && isSecurePage;
  }
  /**
   * Find an installation element using its fixed selector.
   *
   * @param {string} name - Requested sibling name.
   * @returns {HTMLElement|null} Installation element matching the fixed selector.
   */
  find(name) {
    return this.environment.document.querySelector(INSTALL_SELECTORS[name]);
  }
  /**
   * Configure installation or redirect a standalone homepage shortcut.
   */
  setup() {
    const { location } = this.environment;

    if (this.isStandalone && !location.pathname.endsWith("/edit.html")) {
      location.replace(new URL("edit.html?app=1", location.href));

      return;
    }

    this.setupHints();
    this.configureNativeInstall();
    this.connectPrompts();
    if (location.protocol === "file:") {
      this.setStatus(
        "Установка доступна, когда Open Notes открыт по адресу сайта. Сейчас вы можете пользоваться редактором в браузере.",
      );
    }

    void this.removeLegacyWorkers();
  }
  /**
   * Show installation hints and connect the fallback guide link.
   */
  setupHints() {
    const tip = this.find("tip");

    if (this.installButton) {
      this.installButton.textContent = installButtonLabel(this.environment.navigator);
    }

    if (tip) {
      tip.hidden = this.isStandalone;
    }

    if (this.guide && new URLSearchParams(this.environment.location.search).has("install")) {
      this.guide.hidden = false;
    }

    this.installFallback?.addEventListener("click", (event) => {
      if (!this.guide) {
        return;
      }

      event.preventDefault();
      this.guide.hidden = false;
      this.guide.focus();
    });
  }
  /**
   * Update the editor persistence status.
   *
   * @param {string} text - Current file contents.
   */
  setStatus(text) {
    if (this.installStatus) {
      this.installStatus.textContent = text;
    }
  }
  /**
   * Display the available browser prompt or guide link.
   */
  showLegacyInstall() {
    const hideInstallation = this.installed || this.installAccepted;

    if (this.installButton) {
      this.installButton.hidden = hideInstallation || !this.installPrompt;
    }

    if (this.installFallback) {
      this.installFallback.hidden = hideInstallation || Boolean(this.installPrompt);
    }
  }
  /**
   * Replace an unusable native install element with legacy controls.
   *
   * @param {boolean} shouldForce - Whether insecure native support requires forced fallback.
   */
  fallBackFromNative(shouldForce = false) {
    if (!this.shouldUseNativeInstall && !shouldForce) {
      return;
    }

    this.shouldUseNativeInstall = false;
    const replacement = this.environment.document.createElement("span");
    replacement.append(...this.nativeInstall.childNodes);
    this.nativeInstall.replaceWith(replacement);
    this.showLegacyInstall();
  }
  /**
   * Connect native installation results and validity events.
   */
  configureNativeInstall() {
    if (this.isStandalone && this.nativeInstall) {
      this.nativeInstall.hidden = true;
    }

    const canFallBack = !this.isStandalone && this.nativeInstall;
    const isNativeSupported = "HTMLInstallElement" in this.environment.window && !this.shouldUseNativeInstall;

    if (canFallBack && isNativeSupported) {
      this.fallBackFromNative(true);
    }

    if (!this.shouldUseNativeInstall) {
      return;
    }

    this.nativeInstall.classList.add("native-install");
    this.hideLegacyControls();
    this.nativeInstall.addEventListener("installresult", (event) => this.installResult(event));
    this.nativeInstall.addEventListener("promptaction", () => this.markInstalled());
    this.nativeInstall.addEventListener("promptdismiss", () =>
      this.setStatus("Установка отменена. Вы можете попробовать ещё раз."),
    );
    this.nativeInstall.addEventListener("validationstatuschange", () => this.checkValidity());
    this.nativeInstall.addEventListener("validationstatuschanged", () => this.checkValidity());
  }
  /**
   * Hide legacy installation controls while native installation is available.
   */
  hideLegacyControls() {
    if (this.installButton) {
      this.installButton.hidden = true;
    }

    if (this.installFallback) {
      this.installFallback.hidden = true;
    }
  }
  /**
   * Report native installation outcomes and fall back after invalid data.
   *
   * @param {Event} event - Browser event triggering this action.
   */
  installResult(event) {
    if (event.result === "success") {
      this.markInstalled();

      return;
    }

    if (event.result === "aborted") {
      this.setStatus("Установка не завершена. Вы можете попробовать ещё раз.");

      return;
    }

    if (
      ![
        "invalid-data",
        "invalid_data",
      ].includes(event.result)
    ) {
      return;
    }

    this.fallBackFromNative();
    this.setStatus("Не удалось подготовить установку. Используйте кнопку или меню браузера.");
  }
  /**
   * Fall back when the native element reports invalid installation data.
   */
  checkValidity() {
    if (this.nativeInstall.invalidReason !== "install_data_invalid") {
      return;
    }

    this.fallBackFromNative();
    this.setStatus("Установка через этот элемент недоступна. Используйте кнопку или меню браузера.");
  }
  /**
   * Connect browser installation availability and completion events.
   */
  connectPrompts() {
    const { window } = this.environment;
    window.addEventListener("beforeinstallprompt", (event) => {
      if (!this.installButton || this.installed) {
        return;
      }

      event.preventDefault();
      this.installPrompt = event;
      if (!this.shouldUseNativeInstall) {
        this.showLegacyInstall();
      }
    });
    this.installButton?.addEventListener("click", () => this.promptInstall());
    window.addEventListener("appinstalled", () => this.markInstalled());
  }
  /**
   * Replace installation controls with a confirmed result and editor link.
   */
  markInstalled() {
    this.installed = true;
    this.installPrompt = null;
    this.hideLegacyControls();
    if (this.nativeInstall) {
      this.nativeInstall.hidden = true;
    }

    if (this.guide) {
      this.guide.hidden = true;
    }

    if (this.openEditor) {
      this.openEditor.hidden = false;
    }

    this.setStatus("Open Notes установлено. Запускайте его из списка приложений или с главного экрана.");
  }
  /**
   * Request browser installation and restore the controls afterward.
   */
  async promptInstall() {
    if (!this.installPrompt || this.shouldUseNativeInstall) {
      return;
    }

    this.installButton.disabled = true;
    try {
      const prompt = this.installPrompt;
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      this.installAccepted = outcome === "accepted";
      if (this.installed) {
        return;
      }

      this.setStatus(
        outcome === "accepted"
          ? "Установка подтверждена. Дождитесь завершения установки браузером."
          : "Установка отменена. Вы можете продолжить в браузере или открыть инструкцию установки.",
      );
    } catch {
      this.setStatus("Откройте меню браузера и выберите установку приложения.");
    } finally {
      this.installPrompt = null;
      this.installButton.disabled = false;
      this.showLegacyInstall();
    }
  }
  /**
   * Remove only legacy Open Notes registrations and caches.
   */
  async removeLegacyWorkers() {
    const { navigator, window, location, caches } = this.environment;

    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
      return;
    }

    try {
      const registrations = await navigator.serviceWorker.getRegistrations();

      const scopes = new Set([
        new URL("./", location.href).href,
        new URL("/", location.href).href,
      ]);

      await Promise.all(
        registrations
          .filter((registration) => this.isLegacyWorker(registration, scopes))
          .map((registration) => registration.unregister()),
      );
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((key) => key.startsWith("open-notes-")).map((key) => caches.delete(key)),
        );
      }
    } catch {
      // Cleanup is optional and must not interrupt installation or editing.
    }
  }
  /**
   * Match an old Open Notes worker within the application scopes.
   *
   * @param {object} registration - Service worker registration to inspect.
   * @param {Array<object>} scopes - Ordered root and nested ignore scopes.
   * @returns {boolean} Whether the registration belongs to the legacy application worker.
   */
  isLegacyWorker(registration, scopes) {
    return (
      scopes.has(registration.scope) &&
      [
        registration.active,
        registration.waiting,
        registration.installing,
      ].some((worker) => worker && new URL(worker.scriptURL).pathname.endsWith("/sw.js"))
    );
  }
}

/**
 * Connect native installation, browser prompts and legacy cleanup.
 *
 * @param {object} environment - Browser dependencies supplied by the caller.
 */
export function setupInstall(environment = globalThis) {
  new BrowserInstall(environment).setup();
}
