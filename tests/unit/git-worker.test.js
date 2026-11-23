import { expect, it, vi } from "vitest";

import { receive } from "../../src/js/git/worker.js";

vi.mock("../../src/js/git/repo.js", () => ({
  Repo: class {
    async repository() {
      return { branch: "main" };
    }
    async diff() {
      throw new Error("broken");
    }
  },
}));

it("initializes the worker with granted handles and returns read results or failures", async () => {
  const post = vi.fn();
  vi.stubGlobal("postMessage", post);
  await receive({ data: { id: 1, operation: "initialize", args: {} } });
  expect(post).toHaveBeenLastCalledWith({ id: 1, data: {} });
  await receive({ data: { id: 2, operation: "repository" } });
  expect(post).toHaveBeenLastCalledWith({ id: 2, data: { branch: "main" } });
  await receive({ data: { id: 3, operation: "diff", args: { path: "note" } } });
  expect(post).toHaveBeenLastCalledWith({ id: 3, error: "broken" });
});
