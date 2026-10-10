export default async function verifyMobileBanner(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    globalThis.showDirectoryPicker = undefined;
    globalThis.showOpenFilePicker = undefined;
  });

  await page.goto("/edit.html");
  await page.waitForFunction(() => document.querySelector(".app")?.dataset.ready === "true");
  await page.evaluate(async () => {
    const awaitedResult1 = await import("/js/entries/editor.js");
    globalThis.notesApplication = awaitedResult1.application;
  });
  const banner = page.locator('[data-workspace-target="banner"]');
  const awaitedResult2 = await banner.textContent();
  const awaitedResult3 = await banner.textContent();
  if (
    !awaitedResult2.includes("Браузер не поддерживает автосохранение") ||
    awaitedResult3.includes("HTTPS")
  ) {
    throw new Error("Unsupported API copy is incorrect");
  }
  const before = await page.locator(".main").boundingBox();
  await page.getByRole("button", { name: "Закрыть предупреждение" }).click();
  if (await banner.isVisible()) {
    throw new Error("Banner did not close");
  }
  const after = await page.locator(".main").boundingBox();
  if (after.height <= before.height || after.y >= before.y) {
    throw new Error("Banner space was not reclaimed");
  }
  if (
    !(await page
      .getByRole("button", { name: "Файлы", exact: true })
      .evaluate((element) => element === document.activeElement))
  ) {
    throw new Error("Mobile keyboard focus not restored");
  }
  await page.locator('[data-workspace-target="fileInput"]').setInputFiles("tests/fixtures/banner-notes.md");
  await page.getByText("banner-notes.md", { exact: true }).first().click();
  await page.locator(".cm-content").fill("# Mobile note edited");
  if (!(await page.locator('[data-editor-target="download"]').isVisible())) {
    throw new Error("Download unavailable");
  }
  await page.evaluate(() => {
    const c = globalThis.notesApplication.getControllerForElementAndIdentifier(
      document.querySelector('[data-controller~="workspace"]'),
      "workspace",
    );
    c.enableFallback("permission");
    if (
      !c.bannerTarget.textContent.includes("Доступ к файлам ограничен") ||
      c.bannerTarget.classList.contains("visible")
    ) {
      throw new Error("Permission reason or dismissal failed");
    }
  });
  await page.goto("/edit.html");
  await page.waitForFunction(() => document.querySelector(".app")?.dataset.ready === "true");
  await page.evaluate(async () => {
    const awaitedResult4 = await import("/js/entries/editor.js");
    globalThis.notesApplication = awaitedResult4.application;
  });
  await page.evaluate(() => {
    const c = globalThis.notesApplication.getControllerForElementAndIdentifier(
      document.querySelector('[data-controller~="workspace"]'),
      "workspace",
    );
    c.enableFallback("insecure");
    if (!c.bannerTarget.textContent.includes("HTTPS")) {
      throw new Error("Insecure context guidance missing");
    }
  });

  return {
    unsupportedWithoutHttps: true,
    closable: true,
    editorSpaceRestored: true,
    editable: true,
    reasonsSeparated: true,
  };
}
