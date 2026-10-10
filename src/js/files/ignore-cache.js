export class IgnoreFileCache {
  /**
   * Restore rule contents belonging to one remembered native workspace.
   *
   * @param {Array} entries - Previously read ignore files and their metadata.
   */
  constructor(entries = []) {
    this.files = new Map(entries);
  }
  /**
   * Validate current metadata before reusing previously read rules.
   *
   * @param {string} path - Project-relative ignore file path.
   * @param {object} handle - Native ignore file handle.
   * @returns {Promise<string>} Rules matching the current file snapshot.
   */
  async read(path, handle) {
    const file = await handle.getFile();
    const cached = this.files.get(path);

    if (cached?.size === file.size && cached.modified === file.lastModified) {
      return cached.text;
    }

    const text = await file.text();
    this.files.set(path, { size: file.size, modified: file.lastModified, text });

    return text;
  }
  /**
   * Serialize rule snapshots for the browser's local workspace setting.
   *
   * @returns {Array} Ignore file metadata and rules belonging to this workspace.
   */
  snapshot() {
    return [
      ...this.files,
    ];
  }
}
