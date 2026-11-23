import { afterEach, expect, it, vi } from "vitest";

import {
  parseGitConnection,
  rememberGitConnection,
  requestGit,
  restoreGitConnection,
} from "../../src/js/git.js";

const LINK = `http://127.0.0.1:34567/#${"a".repeat(64)}`;

afterEach(() => sessionStorage.clear());

it("accepts only a loopback helper link with a complete session token", () => {
  expect(parseGitConnection(LINK)).toEqual({ base: "http://127.0.0.1:34567/", token: "a".repeat(64) });
  for (const link of [
    "https://example.com/#key",
    "http://localhost:34567/#key",
    LINK.replace("/#", "/file#"),
    LINK.replace("/#", "/?query#"),
    LINK.replace("127.0.0.1", "user:pass@127.0.0.1"),
    LINK.slice(0, -1),
    "bad URL",
  ]) {
    expect(() => parseGitConnection(link)).toThrow();
  }
});

it("takes the helper key out of the URL without losing unrelated fragment data", () => {
  const env = {
    location: { href: `https://notes.test/edit.html#tab=notes&git=${encodeURIComponent(LINK)}` },
    history: { replaceState: vi.fn() },
  };
  expect(restoreGitConnection(env)).toBe(LINK);
  expect(env.history.replaceState.mock.calls[0][2].hash).toBe("#tab=notes");
});

it("resumes only this tab's connection and tolerates blocked storage", () => {
  rememberGitConnection(LINK);
  expect(restoreGitConnection()).toBe(LINK);
  rememberGitConnection("");
  expect(restoreGitConnection()).toBe("");
  const env = {
    location: { href: "https://notes.test/edit.html" },
    sessionStorage: {
      getItem() {
        throw new Error("blocked");
      },
    },
  };
  expect(restoreGitConnection(env)).toBe("");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(() => rememberGitConnection(LINK)).not.toThrow();
});

it("uses authorization, skips credentials and rejects redirects for local Git reads", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({ ok: true, json: async () => ({ branch: "main" }) });
  const signal = new AbortController().signal;
  expect(await requestGit(parseGitConnection(LINK), "/repository", signal)).toEqual({ branch: "main" });
  expect(fetch.mock.calls[0][1]).toMatchObject({
    credentials: "omit",
    redirect: "error",
    targetAddressSpace: "loopback",
    headers: { Authorization: `Bearer ${"a".repeat(64)}` },
  });
  fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Git stopped" }) });
  await expect(requestGit(parseGitConnection(LINK), "/repository", signal)).rejects.toThrow("Git stopped");
  fetch.mockRejectedValueOnce(new TypeError("Network denied"));
  await expect(requestGit(parseGitConnection(LINK), "/repository", signal)).rejects.toThrow(
    "разрешите доступ",
  );
});
