import { Application } from "@hotwired/stimulus";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import SidebarController from "../../src/js/controllers/sidebar_controller.js";

let app, controller, workspace, sidebar, separator;
const viewportWidth = innerWidth;
const pointer = (extra = {}) => ({
  button: 0,
  pointerId: 1,
  clientX: 260,
  preventDefault: vi.fn(),
  ...extra,
});
beforeEach(async () => {
  document.body.innerHTML =
    '<main><aside data-controller="sidebar"><div data-sidebar-target="separator"></div></aside></main>';
  workspace = document.querySelector("main");
  sidebar = document.querySelector("aside");
  separator = sidebar.firstElementChild;
  vi.spyOn(workspace, "clientWidth", "get").mockReturnValue(1200);
  vi.spyOn(sidebar, "getBoundingClientRect").mockImplementation(() => ({
    width: Number(workspace.style.getPropertyValue("--sidebar-w").replace("px", "")) || 260,
  }));
  let captured = null;
  separator.setPointerCapture = vi.fn((id) => {
    captured = id;
  });
  separator.hasPointerCapture = vi.fn((id) => captured === id);
  separator.releasePointerCapture = vi.fn(() => {
    captured = null;
  });
  app = Application.start();
  app.register("sidebar", SidebarController);
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  controller = app.getControllerForElementAndIdentifier(sidebar, "sidebar");
});
afterEach(() => {
  app.unload("sidebar");
  app.stop();
  Object.defineProperty(globalThis, "innerWidth", { value: viewportWidth, configurable: true });
});

it("drags without jumping and clamps both width limits", () => {
  controller.start(pointer({ clientX: 263 }));
  controller.move(pointer({ clientX: 363 }));
  expect(workspace.style.getPropertyValue("--sidebar-w")).toBe("360px");
  expect(separator.getAttribute("aria-valuenow")).toBe("360");
  controller.move(pointer({ clientX: 2000 }));
  expect(workspace.style.getPropertyValue("--sidebar-w")).toBe("560px");
  controller.move(pointer({ clientX: 0 }));
  expect(workspace.style.getPropertyValue("--sidebar-w")).toBe("220px");
  controller.finish(pointer());
  expect(workspace.classList.contains("sidebar-resizing")).toBe(false);
  expect(separator.releasePointerCapture).toHaveBeenCalledWith(1);
});

it("ignores right clicks and unrelated pointers", () => {
  controller.start(pointer({ button: 2 }));
  expect(separator.setPointerCapture).not.toHaveBeenCalled();
  controller.move(pointer());
  expect(workspace.style.getPropertyValue("--sidebar-w")).toBe("");
  controller.start(pointer());
  controller.start(pointer({ pointerId: 2 }));
  controller.move(pointer({ pointerId: 2, clientX: 400 }));
  controller.finish(pointer({ pointerId: 2 }));
  expect(workspace.classList.contains("sidebar-resizing")).toBe(true);
  expect(workspace.style.getPropertyValue("--sidebar-w")).toBe("");
});

it.each(["ArrowLeft", "ArrowRight", "Home", "End", "Enter"])("resizes using %s", (key) => {
  const widths = { ArrowLeft: "244px", ArrowRight: "276px", Home: "220px", End: "560px", Enter: "260px" };
  const event = { key, preventDefault: vi.fn() };
  controller.keydown(event);
  expect(workspace.style.getPropertyValue("--sidebar-w")).toBe(widths[key]);
  expect(event.preventDefault).toHaveBeenCalled();
});

it("leaves other keys alone and restores default width on reset", () => {
  const event = { key: "Tab", preventDefault: vi.fn() };
  controller.keydown(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  controller.resize(450);
  controller.reset();
  expect(workspace.style.getPropertyValue("--sidebar-w")).toBe("260px");
});

it("limits width to leave space for the editor", () => {
  vi.spyOn(workspace, "clientWidth", "get").mockReturnValue(800);
  controller.resize(560);
  expect(workspace.style.getPropertyValue("--sidebar-w")).toBe("440px");
  expect(separator.getAttribute("aria-valuemax")).toBe("440");
});

it("stops dragging on mobile and refuses to start another drag", () => {
  controller.start(pointer());
  Object.defineProperty(globalThis, "innerWidth", { value: 390, configurable: true });
  controller.sync();
  controller.start(pointer());
  expect(controller.pointerId).toBeNull();
  expect(workspace.classList.contains("sidebar-resizing")).toBe(false);
});

it("cleans up after losing capture and while disconnecting during a drag", () => {
  controller.start(pointer());
  separator.hasPointerCapture.mockReturnValue(false);
  controller.finish(pointer());
  expect(separator.releasePointerCapture).not.toHaveBeenCalled();
  controller.start(pointer());
  separator.hasPointerCapture.mockReturnValue(true);
  sidebar.remove();
  controller.disconnect();
  expect(workspace.classList.contains("sidebar-resizing")).toBe(false);
  expect(separator.releasePointerCapture).toHaveBeenCalledWith(1);
});
