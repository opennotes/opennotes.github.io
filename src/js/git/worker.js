import { Buffer } from "buffer/";

// eslint-disable-next-line unicorn/no-top-level-side-effects -- Worker entry supplies the byte API required by isomorphic-git.
Object.assign(globalThis, { Buffer });

const state = { repo: null };

/**
 * Run Git off the editor thread; only structured data and granted handles cross the boundary.
 *
 * @param {MessageEvent} event - Initialize or read request from the Git view.
 */
export async function receive(event) {
  const { id, operation, args } = event.data;

  try {
    if (operation === "initialize") {
      const { Repo } = await import("./repo.js");
      state.repo = new Repo(args);
      postMessage({ id, data: {} });

      return;
    }

    const data = await state.repo[operation](args);
    postMessage({ id, data });
  } catch (error) {
    postMessage({ id, error: error.message });
  }
}

// eslint-disable-next-line unicorn/no-top-level-side-effects -- This module is the dedicated worker entry point.
addEventListener("message", receive);
