const DIRECTORY_MODE = 0o04_0755;
const FILE_MODE = 0o10_0644;

const WORKTREE_FILES = new Set([
  "HEAD",
  "index",
  "config.worktree",
  "commondir",
  "gitdir",
  "logs",
]);

const PRIVATE_REFS = new Set([
  "bisect",
  "worktree",
  "rewritten",
]);

const METADATA_LIMIT = 134_217_728;
const WORKING_FILE_LIMIT = 33_554_432;

/**
 * Attach a filesystem code understood by the Git reader.
 *
 * @param {string} code - Filesystem or repository failure code.
 * @param {string} message - Human-readable explanation.
 * @returns {Error} Coded error safe to send across the worker boundary.
 */
export function gitError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Normalize Git's virtual paths without allowing traversal outside the grant.
 *
 * @param {string} path - Absolute path beneath the virtual repository root.
 * @returns {Array<string>} Validated handle names.
 */
function pathParts(path) {
  if (typeof path !== "string" || !(path === "/repo" || path.startsWith("/repo/"))) {
    throw gitError("ENOENT", "Путь находится вне открытой папки.");
  }

  const parts = [];

  for (const part of path.slice("/repo".length).split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === ".." || part.includes("\0")) {
      throw gitError("ENOENT", "Недопустимый путь Git.");
    }

    parts.push(part);
  }

  return parts;
}

/**
 * Walk only directory handles the user has already authorized.
 *
 * @param {FileSystemDirectoryHandle} root - Selected directory handle.
 * @param {Array<string>} parts - Validated path components.
 * @returns {Promise<FileSystemHandle>} Existing file or directory.
 */
async function descend(root, parts) {
  let current = root;

  for (const [
    index,
    name,
  ] of parts.entries()) {
    try {
      // Each handle is relative to the previous directory.
      // eslint-disable-next-line no-await-in-loop
      current = await current.getDirectoryHandle(name);
    } catch (error) {
      if (error.name !== "TypeMismatchError" || index !== parts.length - 1) {
        throw error;
      }

      // eslint-disable-next-line no-await-in-loop -- Only the final component can be a file.
      current = await current.getFileHandle(name);
    }
  }

  return current;
}

/**
 * Present native handles as the read-only filesystem required by isomorphic-git.
 */
export class GitFileSystem {
  shouldIgnore;
  /**
   * Mount the working folder and the private/shared metadata handles.
   *
   * @param {object} definition - Authorized root, gitdir and common directory handles.
   */
  constructor(definition) {
    this.definition = definition;

    this.promises = {
      readFile: (path, options) => this.readFile(path, options),
      readdir: (path) => this.readdir(path),
      stat: (path) => this.stat(path),
      lstat: (path) => this.stat(path),
      readlink: denied,
      writeFile: denied,
      mkdir: denied,
      rmdir: denied,
      unlink: denied,
      symlink: denied,
    };
  }
  /**
   * Resolve worktree-private index/HEAD and shared objects/refs without copying them.
   *
   * @param {string} path - Virtual repository path.
   * @returns {Promise<FileSystemHandle>} Existing authorized handle.
   */
  async handle(path) {
    const parts = pathParts(path);
    let root = this.definition.root;

    if (parts[0] === ".git") {
      parts.shift();
      const isPrivateReference = parts[0] === "refs" && PRIVATE_REFS.has(parts[1]);
      const isPrivate = parts.length === 0 || WORKTREE_FILES.has(parts[0]) || isPrivateReference;
      root = isPrivate ? this.definition.gitdir : this.definition.common;
    }

    try {
      return await descend(root, parts);
    } catch (error) {
      if (error.name === "NotFoundError" || error.name === "TypeMismatchError") {
        throw gitError("ENOENT", path);
      }

      throw error;
    }
  }
  /**
   * Read bytes only after checking the file's size against a bounded memory budget.
   *
   * @param {string} path - Virtual path to an existing file.
   * @param {string|object} options - Optional UTF-8 encoding request.
   * @returns {Promise<Uint8Array|string>} Original file bytes or decoded metadata.
   */
  async readFile(path, options) {
    const handle = await this.handle(path);

    if (handle.kind !== "file") {
      throw gitError("EISDIR", path);
    }

    const file = await handle.getFile();
    const limit = path.startsWith("/repo/.git/") ? METADATA_LIMIT : WORKING_FILE_LIMIT;

    if (file.size > limit) {
      throw gitError("TOO_LARGE", "Файл Git слишком большой для безопасного просмотра в браузере.");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const encoding = typeof options === "string" ? options : options?.encoding;

    return encoding === "utf8" ? new TextDecoder().decode(bytes) : bytes;
  }
  /**
   * Enumerate directory names directly from disk, including Git metadata.
   *
   * @param {string} path - Existing virtual directory path.
   * @returns {Promise<Array<string>>} Literal child names.
   */
  async readdir(path) {
    const handle = await this.handle(path);

    if (handle.kind !== "directory") {
      throw gitError("ENOTDIR", path);
    }

    const names = [];
    const isMetadata = path === "/repo/.git" || path.startsWith("/repo/.git/");

    for await (const entry of handle.values()) {
      const relative = `${path.slice("/repo/".length)}/${entry.name}`.replace(/^\//, "");

      if (this.shouldIgnore && !isMetadata && (await this.shouldIgnore(relative, entry.kind))) {
        continue;
      }

      names.push(entry.name);
    }

    return names;
  }
  /**
   * Supply conservative metadata so Git verifies content instead of trusting inode caches.
   *
   * @param {string} path - Existing virtual file or directory path.
   * @returns {Promise<object>} Node-compatible read-only stat information.
   */
  async stat(path) {
    const handle = await this.handle(path);
    const isDirectory = handle.kind === "directory";
    const file = isDirectory ? null : await handle.getFile();

    const stats = {
      mode: isDirectory ? DIRECTORY_MODE : FILE_MODE,
      size: file?.size || 0,
      mtimeMs: file?.lastModified || 0,
      ctimeMs: file?.lastModified || 0,
      uid: 0,
      gid: 0,
      ino: 0,
      dev: 0,
      isFile: () => !isDirectory,
      isDirectory: () => isDirectory,
      isSymbolicLink: () => false,
    };

    return stats;
  }
}

/**
 * Reject writes at the filesystem boundary.
 *
 * @returns {Promise<never>} Read-only failure.
 */
function denied() {
  return Promise.reject(gitError("EROFS", "Просмотр Git не изменяет репозиторий."));
}
