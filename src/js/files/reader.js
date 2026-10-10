const KIBIBYTE = 1024;
const MAX_PREVIEW_MEBIBYTES = 8;
const MAX_PREVIEW_BYTES = MAX_PREVIEW_MEBIBYTES * KIBIBYTE * KIBIBYTE;
const MAX_BACKGROUND_BYTES = 2 * KIBIBYTE * KIBIBYTE;
const MAX_CACHE_MEBIBYTES = 32;
const MAX_CACHE_BYTES = MAX_CACHE_MEBIBYTES * KIBIBYTE * KIBIBYTE;
const PREFETCH_CONCURRENCY = 4;
const PREFETCH_QUEUE_LIMIT = 32;
const BINARY_TYPE = "application/octet-stream";

const PREVIEW_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  zip: "application/zip",
  gz: "application/gzip",
  exe: "application/octet-stream",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * Compare a cache entry against the current file metadata.
 *
 * @param {object|undefined} entry - Optional cache entry to validate.
 * @param {File} file - File snapshot used for this operation.
 * @returns {boolean} Whether size and modification time still match.
 */
function isMatchingFile(entry, file) {
  return entry?.size === file.size && entry.modified === file.lastModified;
}

/**
 * Check whether a preview fits the per-file memory limit.
 *
 * @param {string} type - Browser preview MIME type.
 * @param {File} file - File snapshot used for this operation.
 * @returns {boolean} Whether a supported preview fits the memory limit.
 */
function canBufferPreview(type, file) {
  return Boolean(type) && /^(image\/|application\/pdf$)/.test(type) && file.size <= MAX_PREVIEW_BYTES;
}

/**
 * Classify a text read that may contain binary bytes.
 *
 * @param {File} file - File snapshot used for this operation.
 * @param {string} text - Current file contents.
 * @returns {object} File snapshot, detected binary type and text contents.
 */
function textResult(file, text) {
  const binaryType = file.type || BINARY_TYPE;
  const type = text.includes("\0") ? binaryType : null;

  return {
    file,
    type,
    text,
  };
}

export class ProjectReader {
  /**
   * Create the state needed by this collaborator.
   *
   * @param {object} project - Shared project model.
   */
  constructor(project) {
    this.project = project;
    this.textReads = new WeakMap();
    this.prefetchQueue = [];
    this.prefetchActive = 0;
    this.previewCache = new Map();
    this.previewCacheBytes = 0;
  }
  /**
   * Cancel queued background reads.
   */
  cancel() {
    this.prefetchQueue = [];
  }
  /**
   * Clear state belonging to the previous project.
   */
  reset() {
    this.cancel();
    this.previewCache.clear();
    this.previewCacheBytes = 0;
  }
  /**
   * Remove queued reads and cached previews outside the current project.
   */
  prune() {
    const nodes = new Set(this.project.nodes.values());
    this.prefetchQueue = this.prefetchQueue.filter((node) => nodes.has(node));
    for (const [
      node,
      entry,
    ] of this.previewCache) {
      if (nodes.has(node)) {
        continue;
      }

      this.previewCacheBytes -= entry.size;
      this.previewCache.delete(node);
    }
  }
  /**
   * Queue small files revealed by the user for background reading.
   *
   * @param {Iterable<string>} paths - Project paths affected by this operation.
   */
  prefetchVisibleFiles(paths) {
    this.prefetchQueue = [
      ...paths,
    ]
      .toReversed()
      .filter((path) => path.split("/").every((part) => !part.startsWith(".")))
      .map((path) => this.project.nodes.get(path))
      .filter((node) => this.needsPrefetch(node))
      .slice(0, PREFETCH_QUEUE_LIMIT);
    this.runPrefetch();
  }
  /**
   * Check whether a visible file still needs background reading.
   *
   * @param {object} node - Project node being read or modified.
   * @returns {boolean} Whether an uncached file needs a background read.
   */
  needsPrefetch(node) {
    if (node?.kind !== "file" || node.readPromise) {
      return false;
    }

    return !node.searchCache && !this.previewCache.has(node);
  }
  /**
   * Start queued reads within the concurrency limit.
   */
  runPrefetch() {
    while (this.prefetchActive < PREFETCH_CONCURRENCY && this.prefetchQueue.length > 0) {
      const node = this.prefetchQueue.shift();
      this.prefetchActive++;
      void this.prefetchNode(node);
    }
  }
  /**
   * Complete an optional background read and advance the queue.
   *
   * @param {object} node - Project node being read or modified.
   */
  async prefetchNode(node) {
    try {
      await this.readNode(node, null, true);
    } catch {
      // Prefetch is optional; foreground reads report errors to the user.
    } finally {
      this.prefetchActive--;
      this.runPrefetch();
    }
  }
  /**
   * Read a node using shared text reads and bounded preview caching.
   *
   * @param {object} node - Project node being read or modified.
   * @param {File|null} suppliedFile - Optional file snapshot supplied by the caller.
   * @param {boolean} isBackground - Whether this read is optional background work.
   * @returns {Promise<object|null>} File snapshot, preview type and text, or null for a skipped background read.
   */
  async readNode(node, suppliedFile = null, isBackground = false) {
    const projectVersion = this.project.projectVersion;
    const file = suppliedFile || (await node.handle.getFile());

    if (isBackground && projectVersion !== this.project.projectVersion) {
      return null;
    }

    const type = this.previewType(file);
    const cached = this.cachedResult(node, file, type);

    if (cached) {
      return cached;
    }

    if (isBackground && this.skipBackground(file, type)) {
      return null;
    }

    return this.sharedRead(node, { file, type, projectVersion, isBackground });
  }
  /**
   * Reuse matching text or preview data for the current file.
   *
   * @param {object} node - Project node being read or modified.
   * @param {File} file - File snapshot used for this operation.
   * @param {string} type - Browser preview MIME type.
   * @returns {object|null} Matching cached text or preview, or null for a cache miss.
   */
  cachedResult(node, file, type) {
    if (!type && node.text !== undefined) {
      return textResult(file, node.text);
    }

    if (!type && isMatchingFile(node.searchCache, file)) {
      return textResult(file, node.searchCache.text);
    }

    const cached = this.previewCache.get(node);

    if (!type || !isMatchingFile(cached, file)) {
      return null;
    }

    this.previewCache.delete(node);
    this.previewCache.set(node, cached);

    return {
      file: cached.file,
      type,
      text: null,
    };
  }
  /**
   * Check whether a file exceeds background reading limits.
   *
   * @param {File} file - File snapshot used for this operation.
   * @param {string} type - Browser preview MIME type.
   * @returns {boolean} Whether background reading must skip this file.
   */
  skipBackground(file, type) {
    if (file.size > MAX_BACKGROUND_BYTES) {
      return true;
    }

    return Boolean(type) && !canBufferPreview(type, file);
  }
  /**
   * Share a node read and retry when its metadata changes.
   *
   * @param {object} node - Project node being read or modified.
   * @param {object} request - Metadata and state associated with this read.
   * @returns {Promise<object>} Completed read shared with other consumers of the node.
   */
  async sharedRead(node, request) {
    if (node.readPromise) {
      const result = await node.readPromise;

      if (isMatchingFile({ size: result.file.size, modified: result.file.lastModified }, request.file)) {
        return result;
      }

      return this.readNode(node, request.file, request.isBackground);
    }

    const promise = this.readContents(node, request);
    node.readPromise = promise;
    try {
      return await promise;
    } finally {
      node.readPromise = null;
    }
  }
  /**
   * Read text or buffer a small browser preview.
   *
   * @param {object} node - Project node being read or modified.
   * @param {object} request - Metadata and state associated with this read.
   * @returns {Promise<object>} Text or bounded browser preview data for the file.
   */
  async readContents(node, request) {
    const { file, type, projectVersion } = request;

    if (!type) {
      const text = await this.readText(node, file);

      return textResult(file, text);
    }

    if (!canBufferPreview(type, file)) {
      return {
        file,
        type,
        text: null,
      };
    }

    const buffer = await file.arrayBuffer();

    const bufferedFile = new File(
      [
        buffer,
      ],
      file.name,
      { type, lastModified: file.lastModified },
    );

    if (projectVersion === this.project.projectVersion) {
      this.cachePreview(node, bufferedFile);
    }

    return {
      file: bufferedFile,
      type,
      text: null,
    };
  }
  /**
   * Insert a preview and evict the oldest entries over the memory limit.
   *
   * @param {object} node - Project node being read or modified.
   * @param {File} file - File snapshot used for this operation.
   */
  cachePreview(node, file) {
    const previous = this.previewCache.get(node);
    this.previewCacheBytes -= previous?.size || 0;
    this.previewCache.delete(node);
    this.previewCache.set(node, { file, size: file.size, modified: file.lastModified });
    this.previewCacheBytes += file.size;
    while (this.previewCacheBytes > MAX_CACHE_BYTES) {
      const oldest = this.previewCache.keys().next().value;
      this.previewCacheBytes -= this.previewCache.get(oldest).size;
      this.previewCache.delete(oldest);
    }
  }
  /**
   * Read searchable text while preserving the active draft.
   *
   * @param {object} node - Project node being read or modified.
   * @returns {Promise<string>} Searchable text, with binary file contents omitted.
   */
  async readSearchText(node) {
    const file = await node.handle.getFile();

    if (
      /^(image|audio|video)\//.test(file.type) ||
      /\.(pdf|zip|gz|exe|woff2?|ttf|ico|png|jpe?g|gif|webp)$/i.test(node.name)
    ) {
      return "";
    }

    const text = await this.readText(node, file);

    return text.includes("\0") ? "" : text;
  }
  /**
   * Share a text read while preventing stale cache replacement.
   *
   * @param {object} node - Project node being read or modified.
   * @param {File} file - File snapshot used for this operation.
   * @returns {Promise<string>} Current file text from the live draft or shared read.
   */
  async readText(node, file) {
    if (isMatchingFile(node.searchCache, file)) {
      return node.searchCache.text;
    }

    const pending = this.textReads.get(node);

    if (isMatchingFile(pending, file)) {
      return await pending.promise;
    }

    const request = { size: file.size, modified: file.lastModified };
    this.textReads.set(node, request);
    request.promise = this.loadText(node, file, request);

    return await request.promise;
  }
  /**
   * Commit text only if its request still owns the cache entry.
   *
   * @param {object} node - Project node being read or modified.
   * @param {File} file - File snapshot used for this operation.
   * @param {object} request - Metadata and state associated with this read.
   * @returns {Promise<string>} Read text committed only while this request owns the cache.
   */
  async loadText(node, file, request) {
    try {
      const text = await file.text();

      if (this.textReads.get(node) === request) {
        node.searchCache = { size: file.size, modified: file.lastModified, text };
      }

      return text;
    } finally {
      if (this.textReads.get(node) === request) {
        this.textReads.delete(node);
      }
    }
  }
  /**
   * Resolve a browser preview MIME type from the file metadata.
   *
   * @param {File} file - File snapshot used for this operation.
   * @returns {string|null} Browser preview MIME type, or null for text editing.
   */
  previewType(file) {
    const extension = file.name.split(".").at(-1).toLowerCase();

    const knownType = PREVIEW_TYPES[extension];

    if (knownType) {
      return knownType;
    }

    const isMedia = /^(image|audio|video)\//.test(file.type);

    const canPreview = isMedia || file.type === "application/pdf";

    return canPreview ? file.type : null;
  }
}
