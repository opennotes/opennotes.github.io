const TIMEOUT = 60_000;

/**
 * Keep worker requests cancelable without adding processing to the editor thread.
 */
export class GitReader {
  /**
   * Load the Git engine only when the user opens its view.
   */
  constructor() {
    this.worker = new Worker(new URL("git/worker.js", import.meta.url), { type: "module" });
    this.pending = new Map();
    this.nextId = 0;
    this.worker.addEventListener("message", ({ data }) => {
      const pending = this.pending.get(data.id);

      if (!pending) {
        return;
      }

      this.pending.delete(data.id);
      clearTimeout(pending.timer);
      if (data.error) {
        pending.reject(new Error(data.error));

        return;
      }

      pending.resolve(data.data);
    });

    this.worker.addEventListener("error", () =>
      this.stop("Не удалось прочитать Git. Попробуйте обновить страницу."),
    );
  }
  /**
   * Send one read operation with a bounded execution time.
   *
   * @param {string} operation - Read method owned by the repository module.
   * @param {object|number|string} args - Granted handles or a selected path/commit.
   * @returns {Promise<object>} Structured repository data.
   */
  request(operation, args) {
    const id = ++this.nextId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.stop("Чтение Git заняло слишком много времени. Попробуйте обновить."),
        TIMEOUT,
      );

      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, operation, args });
    });
  }
  /**
   * Cancel computation and release cached objects when the view closes or changes folder.
   *
   * @param {string} message - Reason for rejecting interrupted requests.
   */
  stop(message = "Чтение отменено.") {
    this.worker.terminate();
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error(message));
    }

    this.pending.clear();
  }
}
