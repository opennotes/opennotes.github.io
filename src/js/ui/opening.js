export class OpeningFeedback {
  /**
   * Bind opening feedback to its live region and busy content area.
   *
   * @param {HTMLElement} region - Visible live region for opening feedback.
   * @param {HTMLElement} content - Content area whose busy state is announced.
   */
  constructor(region, content) {
    this.region = region;
    this.content = content;
    this.version = 0;
  }
  /**
   * Announce a new read before asynchronous work begins.
   *
   * @param {string} message - Project or file currently being opened.
   * @returns {number} Ownership token for this opening operation.
   */
  begin(message) {
    this.region.textContent = message;
    this.region.hidden = false;
    this.content.setAttribute("aria-busy", "true");

    return ++this.version;
  }
  /**
   * Clear feedback only when the completed operation still owns it.
   *
   * @param {number} version - Ownership token captured before opening.
   */
  finish(version) {
    if (version !== this.version) {
      return;
    }

    this.clear();
  }
  /**
   * Cancel feedback and invalidate unfinished operations.
   */
  clear() {
    this.version++;
    this.region.hidden = true;
    this.region.textContent = "";
    this.content.setAttribute("aria-busy", "false");
  }
}
