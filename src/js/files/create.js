const FILE_NAMES = new Set([
  "readme",
  "license",
  "licence",
  "makefile",
  "dockerfile",
  "containerfile",
  "justfile",
  "gemfile",
  "procfile",
]);

const DOT_DIRECTORIES = new Set([
  ".github",
  ".vscode",
  ".idea",
  ".config",
  ".cache",
  ".husky",
  ".well-known",
]);

const INVALID_CHARACTER = /[\\<>:"|?*]/;
const CONTROL_CHARACTER_LIMIT = 32;
const DELETE_CHARACTER = 127;

/**
 * Infer a leaf type while keeping common extensionless files useful.
 *
 * @param {string} name - Leaf name without a trailing separator.
 * @returns {string} File or directory kind.
 */
function inferredKind(name) {
  const lower = name.toLowerCase();

  if (DOT_DIRECTORIES.has(lower)) {
    return "directory";
  }

  const isFile = name.includes(".") || FILE_NAMES.has(lower);

  return isFile ? "file" : "directory";
}

/**
 * Validate a relative creation path and infer its final object type.
 *
 * @param {string} input - User-entered relative path.
 * @param {string} kind - Explicit type override, or empty for automatic detection.
 * @returns {object} Normalized relative path, its parts and final kind.
 */
export function parseCreationPath(input, kind = "") {
  const value = input.trim();
  const isFolder = value.endsWith("/");
  const path = isFolder ? value.slice(0, -1) : value;
  const parts = path.split("/");
  const invalid = parts.some((part) => invalidPart(part));

  if (invalid) {
    throw new Error("Введите относительный путь без пустых частей и недопустимых символов.");
  }

  if (kind && kind !== "file" && kind !== "directory") {
    throw new Error("Выберите файл или папку.");
  }

  const automaticKind = isFolder ? "directory" : inferredKind(parts.at(-1));

  return {
    path,
    parts,
    kind: kind || automaticKind,
  };
}

/**
 * Reject empty names, traversal and characters unsupported by native paths.
 *
 * @param {string} part - One user-entered path component.
 * @returns {boolean} Whether the component is invalid.
 */
function invalidPart(part) {
  if (!part || part.trim() !== part || part.endsWith(".")) {
    return true;
  }

  return [
    ...part,
  ].some((character) => {
    const code = character.codePointAt(0);

    return code < CONTROL_CHARACTER_LIMIT || code === DELETE_CHARACTER || INVALID_CHARACTER.test(character);
  });
}

/**
 * Find a case-normalized sibling in a browser-only project.
 *
 * @param {object} project - Shared project model.
 * @param {string} parentPath - Parent directory relative to the project.
 * @param {string} name - Requested sibling name.
 * @returns {object|undefined} Matching project node, if present.
 */
function findNode(project, parentPath, name) {
  for (const node of project.nodes.values()) {
    if (node.parentPath === parentPath && normalized(node.name) === normalized(name)) {
      return node;
    }
  }
}

/**
 * Keep a downloadable empty file in a browser-only project.
 *
 * @param {string} name - Requested leaf name.
 * @param {string} kind - File or directory kind.
 * @returns {object} Handle-shaped node backing for browser-only operations.
 */
function localHandle(name, kind) {
  return {
    name,
    kind,
    getFile: () =>
      Promise.resolve(
        new File(
          [
            "",
          ],
          name,
        ),
      ),
  };
}

/**
 * Normalize a sibling name for conservative collision checks.
 *
 * @param {string} name - A file or directory name.
 * @returns {string} Case-folded Unicode name.
 */
function normalized(name) {
  return name.normalize("NFC").toLowerCase();
}

/**
 * Find a real sibling without trusting a possibly stale project snapshot.
 *
 * @param {object} parent - Native directory handle.
 * @param {string} name - Requested child name.
 * @returns {Promise<object|undefined>} Existing handle, if any.
 */
async function findHandle(parent, name) {
  for await (const handle of parent.values()) {
    if (normalized(handle.name) === normalized(name)) {
      return handle;
    }
  }
}

class EntryCreation {
  /**
   * Stage all nodes until the requested leaf exists successfully.
   *
   * @param {object} project - Shared project model.
   * @param {object} request - Parent path, input path and optional type override.
   */
  constructor(project, request) {
    this.project = project;
    this.parentPath = request.parentPath || "";
    this.parsed = parseCreationPath(request.path, request.kind);
    this.staged = new Map();
    this.created = [];
  }

  /**
   * Create path components sequentially, preserving all pre-existing entries.
   *
   * @returns {Promise<object>} Created leaf's path and type.
   */
  async run() {
    if (this.parentPath && this.project.nodes.get(this.parentPath)?.kind !== "directory") {
      throw new Error("Папка назначения больше не существует.");
    }

    let parentPath = this.parentPath;
    let parent = this.project.directoryHandle(parentPath);

    try {
      for (const [
        index,
        name,
      ] of this.parsed.parts.entries()) {
        const isLeaf = index === this.parsed.parts.length - 1;
        const kind = isLeaf ? this.parsed.kind : "directory";
        // Each component depends on the parent created immediately before it.
        // eslint-disable-next-line no-await-in-loop
        const node = await this.component({ name, kind, isLeaf, parentPath, parent });
        parentPath = parentPath ? `${parentPath}/${node.name}` : node.name;
        parent = node.handle;
        this.staged.set(parentPath, node);
      }
    } catch (error) {
      throw await this.rollback(error);
    }

    for (const [
      path,
      node,
    ] of this.staged) {
      this.project.nodes.set(path, node);
    }

    this.project.invalidateExclusions();

    return {
      path: parentPath,
      kind: this.parsed.kind,
    };
  }

  /**
   * Reuse a parent or create one missing component without writing file contents.
   *
   * @param {object} location - Component name, type, parent and leaf flag.
   * @returns {Promise<object>} Existing or newly created project node.
   */
  async component(location) {
    const { parent, parentPath, name, kind, isLeaf } = location;

    const existing = this.project.dirHandle
      ? await findHandle(parent, name)
      : findNode(this.project, parentPath, name);

    if (existing) {
      if (isLeaf) {
        throw new Error(`«${name}» уже существует.`);
      }

      if (existing.kind !== "directory") {
        throw new Error(`«${name}» — файл, а не папка.`);
      }

      return {
        name: existing.name,
        kind,
        parentPath,
        handle: this.project.dirHandle ? existing : existing.handle,
      };
    }

    const handle = this.project.dirHandle ? await this.createHandle(location) : localHandle(name, kind);

    return {
      name,
      kind,
      parentPath,
      handle,
    };
  }

  /**
   * Create a native handle, recording only newly created parent directories.
   *
   * @param {object} location - Component name, type and native parent handle.
   * @returns {Promise<object>} Created native handle.
   */
  async createHandle(location) {
    const { parent, name, kind } = location;

    if (kind === "file") {
      return parent.getFileHandle(name, { create: true });
    }

    const handle = await parent.getDirectoryHandle(name, { create: true });
    this.created.push({ parent, name });

    return handle;
  }

  /**
   * Remove only empty directories created by this operation after a failure.
   *
   * @param {Error} error - Original creation failure.
   * @returns {Promise<Error>} Original failure with any cleanup information.
   */
  async rollback(error) {
    const remaining = [];

    for (const { parent, name } of this.created.toReversed()) {
      try {
        // Never recursively remove files another application may have added.
        // eslint-disable-next-line no-await-in-loop
        await parent.removeEntry(name);
      } catch {
        remaining.push(name);
      }
    }

    if (remaining.length > 0) {
      return new Error(`${error.message} Проверьте оставшиеся папки: ${remaining.join(", ")}.`, {
        cause: error,
      });
    }

    return error;
  }
}

/**
 * Create one file or folder with any missing parent directories.
 *
 * @param {object} project - Shared project model.
 * @param {object} request - Parent path, relative input and optional kind override.
 * @returns {Promise<object>} Created leaf's path and type.
 */
export function createEntry(project, request) {
  return new EntryCreation(project, request).run();
}
