import { afterEach, expect, it } from "vitest";

import { detectInstallBrowser, installButtonLabel, setupInstallGuide } from "../../src/js/install-guide.js";

afterEach(() => document.body.replaceChildren());

it.each([
  ["Mozilla Macintosh Safari/605", 0, "safari", "Установить на Mac"],
  ["Mozilla Macintosh Safari/605", 5, "ios", "Установить приложение"],
  ["iPhone CriOS/148 Safari/605", 1, "ios", "Установить приложение"],
  ["iPad Safari/605", 1, "ios", "Установить приложение"],
  ["iPod Safari/605", 1, "ios", "Установить приложение"],
  ["Android Chrome/148", 5, "android", "Установить приложение"],
  ["Android Firefox/148", 5, "firefox-android", "Установить приложение"],
  ["Windows Chrome/148 Edg/148", 0, "edge", "Установить приложение"],
  ["Windows Firefox/148", 0, "firefox-windows", "Установить приложение"],
  ["Macintosh Firefox/148", 0, "firefox", "Установить на Mac"],
  ["Linux Firefox/148", 0, "firefox", "Установить приложение"],
  ["Macintosh Chrome/148 Safari/605", 0, "chrome", "Установить на Mac"],
  ["Linux Chromium/148", 0, "chrome", "Установить приложение"],
  ["Unknown Safari/605", 0, "other", "Установить приложение"],
  [undefined, 0, "other", "Установить приложение"],
])("selects instructions for %s with %s touch points", (userAgent, maxTouchPoints, section, label) => {
  const navigator = { userAgent, maxTouchPoints };
  expect(detectInstallBrowser(navigator)).toBe(section);
  expect(installButtonLabel(navigator)).toBe(label);
});

it("shows detected instructions and lets the user correct detection", () => {
  document.body.innerHTML = `<label hidden><select data-install-browser>
    <option value="chrome">Chrome</option><option value="ios">iOS</option></select></label>
    <section data-browser-guide="chrome"></section><section data-browser-guide="ios"></section>`;
  setupInstallGuide({ document, navigator: { userAgent: "Chrome/148" } });
  const selector = document.querySelector("select");
  expect(selector.value).toBe("chrome");
  expect(selector.closest("label").hidden).toBe(false);
  expect(document.querySelector('[data-browser-guide="ios"]').hidden).toBe(true);
  selector.value = "ios";
  selector.dispatchEvent(new Event("change"));
  expect(document.querySelector('[data-browser-guide="ios"]').hidden).toBe(false);
  expect(document.querySelector('[data-browser-guide="chrome"]').hidden).toBe(true);
});

it("leaves pages without an installation guide alone", () => {
  setupInstallGuide();
  expect(document.querySelector("[data-install-browser]")).toBeNull();
});
