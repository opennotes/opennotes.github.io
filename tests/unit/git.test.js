import { afterEach, expect, it, vi } from "vitest";

import { GitReader } from "../../src/js/git.js";

let worker;
function createReader() {
  vi.stubGlobal(
    "Worker",
    class {
      listeners = {};
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() {
        worker = Object.assign({}, this);
      }
      addEventListener(name, callback) {
        this.listeners[name] = callback;
      }
    },
  );
  return new GitReader();
}

afterEach(() => {
  vi.useRealTimers();
});

it("resolves worker reads, ignores stale responses and reports worker errors", async () => {
  const reader = createReader();
  const pending = reader.request("repository");
  worker.listeners.message({ data: { id: 90, data: {} } });
  worker.listeners.message({ data: { id: 1, data: { branch: "main" } } });
  await expect(pending).resolves.toEqual({ branch: "main" });
  const failed = reader.request("diff", { path: "note" });
  worker.listeners.message({ data: { id: 2, error: "denied" } });
  await expect(failed).rejects.toThrow("denied");
  const crashed = reader.request("history", 0);
  worker.listeners.error();
  await expect(crashed).rejects.toThrow("Не удалось");
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("terminates slow processing and rejects pending reads on close", async () => {
  let expire;
  vi.spyOn(globalThis, "setTimeout").mockImplementationOnce((callback) => {
    expire = callback;
    return 0;
  });
  const reader = createReader();
  const slow = reader.request("repository");
  expire();
  await expect(slow).rejects.toThrow("слишком много");
  const next = createReader();
  const pending = next.request("repository");
  next.stop();
  await expect(pending).rejects.toThrow("отменено");
});
