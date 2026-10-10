import { File } from "node:buffer";

import { IDBFactory } from "fake-indexeddb";
import { vi, afterEach } from "vitest";

vi.stubGlobal("File", File);
vi.stubGlobal("indexedDB", new IDBFactory());
vi.stubGlobal(
  "matchMedia",
  vi.fn(() => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  })),
);
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
URL.createObjectURL = vi.fn(() => "blob:notes-test");
URL.revokeObjectURL = vi.fn();
Range.prototype.getClientRects = () => [];
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
HTMLElement.prototype.scrollIntoView = vi.fn();
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
  this.dispatchEvent(new Event("close"));
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
