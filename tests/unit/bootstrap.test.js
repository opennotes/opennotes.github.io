import { it, expect, vi } from "vitest";

import { startEditor } from "../../src/js/bootstrap.js";
import { mount } from "../support/workspace.js";

it("boots the real editor entry and registers its controller", async () => {
  const { app } = await mount();
  app.unload("workspace", "tree", "editor", "search");
  app.stop();
  const { application } = await import("../../src/js/entries/editor.js");
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  expect(
    application.getControllerForElementAndIdentifier(
      document.querySelector('[data-controller~="workspace"]'),
      "workspace",
    ),
  ).toBeTruthy();
  application.unload("workspace", "tree", "editor", "search");
  application.stop();
});
it("shows startup failures instead of leaving dead controls", async () => {
  const { app } = await mount();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await startEditor(async () => {
    throw new Error("load");
  });
  expect(document.querySelector('[data-workspace-target="banner"]').textContent).toContain(
    "Не удалось загрузить",
  );
  expect(document.querySelector('[data-action^="workspace#"]').disabled).toBe(true);
  expect(log).toHaveBeenCalled();
  app.unload("workspace", "tree", "editor", "search");
  app.stop();
});
it("executes homepage and installation entrypoints", async () => {
  document.body.innerHTML = "<p data-install-status></p>";
  await import("../../src/js/entries/home.js");
  await import("../../src/js/entries/install.js");
  expect(document.documentElement.style.visibility).not.toBe("hidden");
});
