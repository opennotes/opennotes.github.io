import { it, expect, vi, afterEach } from "vitest";

import { openEditorWhenStandalone } from "../../src/js/home.js";
import { setupInstall } from "../../src/js/install.js";

function environment(options = {}) {
  const {
    standalone = false,
    native = false,
    secure = true,
    protocol = "https:",
    pathname = "/edit.html",
    minimal = false,
  } = options;
  document.body.innerHTML = minimal
    ? ""
    : `<div data-install-tip></div><div tabindex="-1" data-install-guide hidden></div><install data-native-install><button data-install-app hidden></button><a data-install-fallback></a></install><p data-install-status></p>`;
  const window = new EventTarget();
  window.matchMedia = () => ({ matches: standalone });
  window.isSecureContext = secure;
  if (native) {
    window.HTMLInstallElement = class {};
  }
  const location = {
    pathname,
    protocol,
    href: protocol === "file:" ? "file:///notes/edit.html" : `https://notes.test${pathname}`,
    search: options.search || "",
    replace: vi.fn(),
  };
  const caches = { keys: vi.fn(async () => ["open-notes-old", "other"]), delete: vi.fn(async () => true) };
  const navigator = { standalone: options.navigatorStandalone };
  if (options.registrations) {
    navigator.serviceWorker = { getRegistrations: vi.fn(async () => options.registrations) };
  }
  return {
    window,
    location,
    caches,
    navigator,
    document,
  };
}
const fire = (target, type, props = {}) => {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, props);
  target.dispatchEvent(event);
  return event;
};
afterEach(() => document.body.replaceChildren());
it("redirects installed homepage shortcuts before setup", () => {
  const env = environment({ standalone: true, pathname: "/" });
  setupInstall(env);
  expect(env.location.replace).toHaveBeenCalledWith(expect.any(URL));
});
it.each([true, false])("supports saved homepage standalone flag %s", (flag) => {
  document.documentElement.style.visibility = "";
  const env = environment({ navigatorStandalone: flag });
  openEditorWhenStandalone({ matchMedia: env.window.matchMedia, ...env });
  expect(env.location.replace).toHaveBeenCalledTimes(flag ? 1 : 0);
  expect(document.documentElement.style.visibility).toBe(flag ? "hidden" : "");
  document.documentElement.style.visibility = "";
});
it("redirects home in standalone media mode", () => {
  const env = environment({ standalone: true });
  openEditorWhenStandalone({ matchMedia: env.window.matchMedia, ...env });
  expect(env.location.replace.mock.calls[0][0].href).toContain("edit.html?app=1");
  document.documentElement.style.visibility = "";
});
it("shows installation help and reveals it on fallback click", () => {
  const env = environment({ search: "?install=1" });
  setupInstall(env);
  const guide = document.querySelector("[data-install-guide]");
  expect(guide.hidden).toBe(false);
  guide.hidden = true;
  const event = fire(document.querySelector("[data-install-fallback]"), "click");
  expect(event.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(guide);
});
it("tolerates missing installation elements", () => {
  const env = environment({ minimal: true, protocol: "file:" });
  setupInstall(env);
  fire(env.window, "beforeinstallprompt");
  fire(env.window, "appinstalled");
  expect(env.location.replace).not.toHaveBeenCalled();
});
it("tolerates a fallback link without a guide or status", () => {
  const env = environment();
  document.querySelector("[data-install-guide]").remove();
  document.querySelector("[data-install-status]").remove();
  setupInstall(env);
  expect(fire(document.querySelector("[data-install-fallback]"), "click").defaultPrevented).toBe(false);
  fire(env.window, "appinstalled");
});
it("hides installation in standalone editor mode and ignores prompts", () => {
  const env = environment({ standalone: true });
  setupInstall(env);
  expect(document.querySelector("[data-native-install]").hidden).toBe(true);
  expect(fire(env.window, "beforeinstallprompt").defaultPrevented).toBe(false);
});
it("falls back from an insecure native element", () => {
  const env = environment({ native: true, secure: false });
  setupInstall(env);
  expect(document.querySelector("install")).toBeNull();
  expect(document.querySelector("[data-install-fallback]").hidden).toBe(false);
});
it("falls back from native installation opened as a local file", () => {
  const env = environment({ native: true, protocol: "file:" });
  setupInstall(env);
  expect(document.querySelector("[data-install-status]").textContent).toContain("адресу сайта");
});
it.each(["success", "aborted", "unknown"])("handles native install result %s", (result) => {
  const env = environment({ native: true });
  setupInstall(env);
  const element = document.querySelector("install");
  expect(element.classList.contains("native-install")).toBe(true);
  fire(element, "installresult", { result });
  expect(Boolean(document.querySelector("[data-install-status]").textContent)).toBe(result !== "unknown");
});
it.each(["invalid-data", "invalid_data"])("falls back after %s", (result) => {
  const env = environment({ native: true });
  setupInstall(env);
  const element = document.querySelector("install");
  fire(element, "installresult", { result });
  expect(document.querySelector("install")).toBeNull();
  fire(element, "installresult", { result });
  expect(document.querySelector("[data-install-status]").textContent).toContain("Не удалось");
});
it("handles legacy native cancellation and validity events", () => {
  const env = environment({ native: true });
  setupInstall(env);
  const element = document.querySelector("install");
  fire(element, "promptdismiss");
  expect(document.querySelector("[data-install-status]").textContent).toContain("отменена");
  fire(element, "validationstatuschange");
  element.invalidReason = "install_data_invalid";
  fire(element, "validationstatuschanged");
  expect(document.querySelector("install")).toBeNull();
});
it.each(["accepted", "dismissed", "error"])("handles legacy prompt outcome %s", async (outcome) => {
  const env = environment();
  setupInstall(env);
  const button = document.querySelector("[data-install-app]");
  fire(button, "click");
  expect(button.disabled).toBe(false);
  const prompt = vi.fn(async () => {
    if (outcome === "error") {
      throw new Error("blocked");
    }
  });
  const event = fire(env.window, "beforeinstallprompt", { prompt, userChoice: Promise.resolve({ outcome }) });
  expect(event.defaultPrevented).toBe(true);
  expect(button.hidden).toBe(false);
  fire(button, "click");
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(prompt).toHaveBeenCalledOnce();
  expect(document.querySelector("[data-install-status]").textContent).not.toBe("");
  expect(button.hidden).toBe(true);
  fire(env.window, "appinstalled");
  expect(document.querySelector("[data-install-status]").textContent).toContain("установлено");
});
it("keeps native installation active when a legacy prompt is available", () => {
  const env = environment({ native: true });
  setupInstall(env);
  const button = document.querySelector("[data-install-app]");
  fire(env.window, "beforeinstallprompt", { prompt: vi.fn() });
  fire(button, "click");
  expect(button.disabled).toBe(false);
  fire(env.window, "appinstalled");
});
it("supports browsers without installation buttons", () => {
  const env = environment();
  document.querySelector("[data-install-app]").remove();
  setupInstall(env);
  fire(env.window, "beforeinstallprompt");
  fire(env.window, "appinstalled");
  expect(document.querySelector("[data-install-app]")).toBeNull();
});
it("supports native installation without fallback children", () => {
  const env = environment({ native: true });
  document.querySelector("[data-install-app]").remove();
  document.querySelector("[data-install-fallback]").remove();
  setupInstall(env);
  fire(document.querySelector("install"), "installresult", { result: "invalid-data" });
  expect(document.querySelector("install")).toBeNull();
});
it("removes only old Open Notes workers and caches", async () => {
  const old = {
    scope: "https://notes.test/",
    active: { scriptURL: "https://notes.test/sw.js" },
    unregister: vi.fn(async () => true),
  };
  const waiting = {
    scope: "https://notes.test/",
    waiting: { scriptURL: "https://notes.test/sw.js" },
    unregister: vi.fn(async () => true),
  };
  const installing = {
    scope: "https://notes.test/",
    installing: { scriptURL: "https://notes.test/sw.js" },
    unregister: vi.fn(async () => true),
  };
  const other = { scope: "https://other.test/", unregister: vi.fn() };
  const current = {
    scope: "https://notes.test/",
    active: { scriptURL: "https://notes.test/worker.js" },
    unregister: vi.fn(),
  };
  const env = environment({ registrations: [old, waiting, installing, other, current] });
  env.window.caches = env.caches;
  setupInstall(env);
  await vi.waitFor(() => expect(env.caches.delete).toHaveBeenCalledWith("open-notes-old"));
  expect(old.unregister).toHaveBeenCalledOnce();
  expect(waiting.unregister).toHaveBeenCalledOnce();
  expect(installing.unregister).toHaveBeenCalledOnce();
  expect(other.unregister).not.toHaveBeenCalled();
  expect(current.unregister).not.toHaveBeenCalled();
});
it("tolerates worker cleanup failure and missing cache API", async () => {
  const env = environment({ registrations: [] });
  setupInstall(env);
  await Promise.resolve();
  await Promise.resolve();
  expect(env.caches.keys).not.toHaveBeenCalled();
  env.navigator.serviceWorker.getRegistrations = async () => {
    throw new Error("disabled");
  };
  setupInstall(env);
  await Promise.resolve();
});
