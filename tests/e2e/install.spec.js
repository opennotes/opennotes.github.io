import { test, expect } from "@playwright/test";

test("Homepage installation fallback opens browser-specific instructions", async ({ page }) => {
  await page.addInitScript(() => {
    delete globalThis.HTMLInstallElement;
  });
  await page.goto("/");
  await page.locator("[data-install-fallback]").click();
  await expect(page).toHaveURL(/install\.html$/);
  await expect(page.getByRole("heading", { name: "Установка Open Notes", exact: true })).toBeVisible();
  await expect(page.locator("[data-browser-guide]:visible")).toHaveCount(1);
  await page.locator("[data-install-browser]").selectOption("ios");
  await expect(page.getByRole("heading", { name: "На iPhone или iPad", exact: true })).toBeVisible();
});

test("Homepage installation requests the available prompt with one click", async ({ page }) => {
  await page.addInitScript(() => {
    delete globalThis.HTMLInstallElement;
  });
  await page.goto("/");
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: () => {
        document.body.dataset.installRequested = "true";
      },
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    dispatchEvent(event);
  });
  await page.locator("[data-install-app]").click();
  await expect(page.locator("body")).toHaveAttribute("data-install-requested", "true");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-install-status]")).toContainText("отменена");
  await expect(page.locator("[data-install-fallback]")).toBeVisible();
});

test("Completed installation replaces the install action with the editor", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => dispatchEvent(new Event("appinstalled")));
  await expect(page.locator("[data-install-fallback]")).toBeHidden();
  await expect(page.locator("[data-install-app]")).toBeHidden();
  await expect(page.locator("[data-install-status]")).toContainText("установлено");
  await page.locator("[data-install-open]").click();
  await expect(page).toHaveURL(/edit\.html$/);
});

test("Installation guide detects an iPad requesting desktop websites", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperties(navigator, {
      userAgent: { value: "Mozilla/5.0 (Macintosh) Safari/605" },
      maxTouchPoints: { value: 5 },
    });
    delete globalThis.HTMLInstallElement;
  });
  await page.goto("/");
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    dispatchEvent(event);
  });
  await expect(page.locator("[data-install-app]")).toHaveText("Установить приложение");
  await page.goto("/install.html");
  await expect(page.locator("[data-install-browser]")).toHaveValue("ios");
  await expect(page.getByRole("heading", { name: "На iPhone или iPad", exact: true })).toBeVisible();
  await page.evaluate(() => dispatchEvent(new Event("appinstalled")));
  await expect(page.locator("[data-install-guide]")).toBeHidden();
  await expect(page.locator("[data-install-status]")).toContainText("установлено");
});
