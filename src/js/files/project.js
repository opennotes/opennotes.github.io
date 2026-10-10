import { projectExclusions } from "./exclusions.js";
import { writeFile } from "./write.js";

const DIRECTORY_BATCH_SIZE = 6;
const IGNORE_FILE_NAME = ".gitignore";

/**
 * Read ignore rules from a native file snapshot.
 *
 * @param {string} path - Project-relative file or directory path.
 * @param {object} handle - Native file system handle.
 * @returns {Promise<string>} Current contents of the ignore file.
 */
async function readIgnoreFile(path, handle) {
  const file = await handle.getFile();

  return file.text();
}

/**
 * Check whether a path belongs to a node subtree.
 *
 * @param {string} path - Project-relative file or directory path.
 * @param {object} root - Root handle whose enumeration errors must be reported.
 * @returns {boolean} Whether the path is at or below the subtree root.
 */
function belongsTo(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Join a directory path and a child name.
 *
 * @param {string|object} parent - Parent path or destination directory handle.
 * @param {string} name - Requested sibling name.
 * @returns {string} Relative path of the child.
 */
function childPath(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

/**
 * Enumerate a folder while propagating failures for the root.
 *
 * @param {object} handle - Native file system handle.
 * @param {object} root - Root handle whose enumeration errors must be reported.
 * @returns {Promise<Array<object>>} Enumerated folder entries, or an empty list for an inaccessible nested folder.
 */
async function collectEntries(handle, root) {
  const entries = [];

  try {
    for await (const entry of handle.values()) {
      entries.push(entry);
    }
  } catch (error) {
    if (handle === root) {
      throw error;
    }
  }

  return entries;
}

export class Project {
  /**
   * Create the state needed by this collaborator.
   */
  constructor() {
    this.nodes = new Map();
    this.ignoreMatchers = new Map();
    this.ignoreFactoryPromise = null;
    this.dirHandle = null;
    this.fileHandle = null;
    this.currentPath = null;
    this.projectVersion = 0;
    this.operationBusy = false;
    this.workspaceIsDirectory = false;
  }
  /**
   * Load files selected through the fallback browser input.
   *
   * @param {Array<File>} files - File snapshots selected by the user.
   * @param {boolean} isDirectory - Whether the selected workspace is a folder.
   */
  importFiles(files, isDirectory) {
    for (const file of files) {
      const path = isDirectory ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
      const parts = path.split("/");
      this.addUploadedParents(parts);
      this.nodes.set(path, {
        handle: { name: file.name, getFile: () => Promise.resolve(file) },
        kind: "file",
        name: file.name,
        parentPath: parts.slice(0, -1).join("/"),
      });
    }
  }
  /**
   * Add directory nodes inferred from uploaded file paths.
   *
   * @param {Array<string>} parts - Components of an uploaded project path.
   */
  addUploadedParents(parts) {
    for (let index = 1; index < parts.length; index++) {
      const directoryPath = parts.slice(0, index).join("/");
      this.nodes.set(directoryPath, {
        kind: "directory",
        name: parts[index - 1],
        parentPath: parts.slice(0, index - 1).join("/"),
      });
    }
  }
  /**
   * Remove nodes matching the current exclusion predicate.
   *
   * @param {(path: string, kind?: string) => boolean} excluded - Check whether a project path is excluded.
   */
  excludeNodes(excluded) {
    for (const [
      path,
      node,
    ] of this.nodes) {
      if (excluded(path, node.kind)) {
        this.nodes.delete(path);
      }
    }
  }
  /**
   * Order uploaded folders before files and sort sibling names.
   */
  sortNodes() {
    this.nodes = new Map(
      [
        ...this.nodes,
      ].toSorted(
        (
          [
            ,
            a,
          ],
          [
            ,
            b,
          ],
        ) => {
          if (a.kind === b.kind) {
            return a.name.localeCompare(b.name);
          }

          return a.kind === "directory" ? -1 : 1;
        },
      ),
    );
  }
  /**
   * Enumerate folders while applying ignore rules before descending.
   *
   * @param {object} directoryHandle - Native directory handle to enumerate.
   * @param {string} parentPath - Project-relative parent directory path.
   * @param {object} options - Options controlling this file operation.
   */
  async scanDirectory(directoryHandle, parentPath, options = {}) {
    const scan = {
      root: directoryHandle,
      nodes: options.nodes || this.nodes,
      readIgnore: options.readIgnore || readIgnoreFile,
      scopes: [],
      pending: [
        { handle: directoryHandle, path: parentPath },
      ],
    };

    const excluded = projectExclusions(scan.scopes);

    while (scan.pending.length > 0) {
      const batch = scan.pending.splice(0, DIRECTORY_BATCH_SIZE);
      // Each batch discovers the next folders; keep concurrency bounded instead of reading the whole project at once.
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(batch.map((directory) => this.scanFolder(directory, scan, excluded)));
    }
  }
  /**
   * Load a folder's rules before adding allowed entries to the scan.
   *
   * @param {object} directory - Directory handle and relative path being scanned.
   * @param {object} scan - Node map, ignore scopes and pending folders for this scan.
   * @param {(path: string, kind?: string) => boolean} excluded - Check whether a project path is excluded.
   */
  async scanFolder(directory, scan, excluded) {
    const { handle, path: parent } = directory;
    const entries = await collectEntries(handle, scan.root);
    const ignoreFile = entries.find((entry) => entry.kind === "file" && entry.name === IGNORE_FILE_NAME);

    if (ignoreFile) {
      const text = await scan.readIgnore(childPath(parent, IGNORE_FILE_NAME), ignoreFile);
      scan.scopes.push(await this.ignoreScope(parent, text));
    }

    for (const entry of entries) {
      const path = childPath(parent, entry.name);

      if (excluded(path, entry.kind)) {
        continue;
      }

      scan.nodes.set(path, { handle: entry, kind: entry.kind, name: entry.name, parentPath: parent });
      if (entry.kind === "directory") {
        scan.pending.push({ handle: entry, path });
      }
    }
  }
  /**
   * Replace project nodes only when the completed scan is still current.
   *
   * @param {(path: string, handle: object) => Promise<string>} readIgnore - Read the current ignore file through the shared reader.
   * @returns {Promise<boolean>} Whether the fresh node map was committed.
   */
  async refreshDirectory(readIgnore) {
    const version = this.projectVersion;
    const nodes = new Map();
    await this.scanDirectory(this.dirHandle, "", { nodes, readIgnore });
    if (version !== this.projectVersion) {
      return false;
    }

    this.nodes = nodes;

    return true;
  }
  /**
   * Check whether a node subtree contains ignore rules.
   *
   * @param {string} path - Project-relative file or directory path.
   * @returns {boolean} Whether the subtree contains an ignore file.
   */
  containsIgnoreFile(path) {
    return [
      ...this.nodes,
    ].some(
      ([
        key,
        node,
      ]) => belongsTo(key, path) && node.name === IGNORE_FILE_NAME,
    );
  }
  /**
   * Load the Git ignore matcher on demand.
   *
   * @returns {Promise<object>} Loaded Git ignore module.
   */
  loadIgnore() {
    return import("ignore");
  }
  /**
   * Load the matcher and allow retry after an import failure.
   *
   * @returns {Promise<(...args: unknown[]) => unknown>} Factory for compiled Git ignore matchers.
   */
  async createIgnoreFactory() {
    try {
      const module = await this.loadIgnore();

      return module.default;
    } catch (error) {
      this.ignoreFactoryPromise = null;

      throw error;
    }
  }
  /**
   * Discard compiled ignore scopes after rules change.
   */
  invalidateExclusions() {
    this.ignoreMatchers.clear();
  }
  /**
   * Reuse or compile an ignore scope for the requested directory.
   *
   * @param {string|object} parent - Parent path or destination directory handle.
   * @param {string} text - Current file contents.
   * @returns {Promise<object>} Compiled matcher and base path for the directory.
   */
  async ignoreScope(parent, text) {
    const cached = this.ignoreMatchers.get(parent);

    if (cached?.text === text) {
      return cached.scope;
    }

    this.ignoreFactoryPromise ||= this.createIgnoreFactory();
    const createIgnore = await this.ignoreFactoryPromise;

    const scope = {
      base: parent ? `${parent}/` : "",
      matcher: createIgnore({ ignorecase: false }).add(text),
    };

    this.ignoreMatchers.set(parent, { text, scope });

    return scope;
  }
  /**
   * Resolve a project directory handle by relative path.
   *
   * @param {string} path - Project-relative file or directory path.
   * @returns {object|undefined} Native handle for the root or requested directory.
   */
  directoryHandle(path) {
    return path ? this.nodes.get(path)?.handle : this.dirHandle;
  }
  /**
   * Check for an existing sibling using normalized names.
   *
   * @param {string} parentPath - Project-relative parent directory path.
   * @param {string} name - Requested sibling name.
   * @returns {Promise<boolean>} Whether a normalized sibling name already exists.
   */
  async nameExists(parentPath, name) {
    if (this.nodes.has(childPath(parentPath, name))) {
      return true;
    }

    if (!this.dirHandle) {
      return false;
    }

    const parent = this.directoryHandle(parentPath);
    const normalizedName = name.normalize("NFC").toLocaleLowerCase();

    for await (const entry of parent.values()) {
      if (entry.name.normalize("NFC").toLocaleLowerCase() === normalizedName) {
        return true;
      }
    }

    return false;
  }
  /**
   * Choose a sibling name that does not overwrite existing files.
   *
   * @param {string} parentPath - Project-relative parent directory path.
   * @param {string} name - Requested sibling name.
   * @param {string} kind - File or directory kind.
   * @returns {Promise<string>} Available sibling name retaining its file extension.
   */
  async availableName(parentPath, name, kind) {
    let candidate = name;
    const dot = kind === "file" ? name.lastIndexOf(".") : -1;
    const base = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    let index = 1;

    // Candidate names depend on the preceding collision check and must be tested in order.
    // eslint-disable-next-line no-await-in-loop
    while (await this.nameExists(parentPath, candidate)) {
      candidate = `${base} (${index++})${extension}`;
    }

    return candidate;
  }
  /**
   * Copy a file or directory before removing its source.
   *
   * @param {object} source - File or directory handle to copy.
   * @param {string|object} parent - Parent path or destination directory handle.
   * @param {object} options - Options controlling this file operation.
   * @returns {Promise<object>} Completed destination file or directory handle.
   */
  async copyHandle(source, parent, options) {
    const { name, onCreated = () => {} } = options;

    if (source.kind === "directory") {
      const destination = await parent.getDirectoryHandle(name, { create: true });
      onCreated();
      for await (const child of source.values()) {
        await this.copyHandle(child, destination, { name: child.name });
      }

      return destination;
    }

    const destination = await parent.getFileHandle(name, { create: true });
    onCreated();
    const file = await source.getFile();
    await writeFile(destination, file);

    return destination;
  }
  /**
   * Order ignore files so parent scopes precede child scopes.
   *
   * @returns {Array<Array<unknown>>} Ignore file entries ordered by directory depth.
   */
  ignoreFiles() {
    return [
      ...this.nodes,
    ]
      .filter(
        ([
          ,
          node,
        ]) => node.kind === "file" && node.name === IGNORE_FILE_NAME,
      )
      .toSorted(
        (
          [
            a,
          ],
          [
            b,
          ],
        ) => a.split("/").length - b.split("/").length || a.localeCompare(b),
      );
  }
  /**
   * Compile ordered ignore scopes from current project nodes.
   *
   * @param {() => boolean} isCurrent - Check that this asynchronous operation is still active.
   * @param {(path: string, node: object) => Promise<string>} readText - Read project text while preserving the active draft.
   * @returns {Promise<((path: string, kind?: string) => boolean)|null>} Exclusion predicate, or null when the operation became stale.
   */
  async exclusions(isCurrent, readText) {
    const scopes = [];
    const excluded = projectExclusions(scopes);

    for (const [
      path,
      node,
    ] of this.ignoreFiles()) {
      if (!isCurrent()) {
        return null;
      }

      if (excluded(node.parentPath, "directory")) {
        continue;
      }

      // Parent ignore scopes must be applied before reading child scopes.
      // eslint-disable-next-line no-await-in-loop
      const text = await readText(path, node);
      // eslint-disable-next-line no-await-in-loop
      scopes.push(await this.ignoreScope(node.parentPath, text));
    }

    return excluded;
  }
  /**
   * Move a project subtree without overwriting destination files.
   *
   * @param {string} path - Project-relative file or directory path.
   * @param {string} destination - Project-relative destination directory.
   * @param {object} options - Options controlling this file operation.
   * @returns {Promise<object>} Committed destination path and available name.
   */
  async move(path, destination, options) {
    const node = this.nodes.get(path);
    const newName = await this.availableName(destination, options.requestedName || node.name, node.kind);
    const newPath = childPath(destination, newName);

    const subtree = [
      ...this.nodes,
    ].filter(
      ([
        key,
      ]) => belongsTo(key, path),
    );

    const operation = { node, destination, newName, newPath, onCleanupError: options.onCleanupError };

    const moved = this.dirHandle
      ? await this.moveOnDisk(operation)
      : this.remapSubtree(subtree, path, newPath);

    this.invalidateExclusions();
    for (const [
      key,
    ] of subtree) {
      this.nodes.delete(key);
    }

    for (const [
      key,
      value,
    ] of moved) {
      this.nodes.set(key, value);
    }

    return {
      newName,
      newPath,
    };
  }
  /**
   * Copy and inspect the destination before deleting its source.
   *
   * @param {object} operation - Paths, handles and callbacks captured before the operation.
   * @returns {Promise<Map<string, object>>} Inspected destination nodes after source removal succeeds.
   */
  async moveOnDisk(operation) {
    const { node, destination, newName, newPath } = operation;
    const parent = this.directoryHandle(destination);
    let isDestinationCreated = false;

    try {
      const newHandle = await this.copyHandle(node.handle, parent, {
        name: newName,
        onCreated: () => {
          isDestinationCreated = true;
        },
      });

      const moved = new Map();
      await this.collectCopy(newHandle, { path: newPath, parentPath: destination }, moved);
      await this.directoryHandle(node.parentPath).removeEntry(node.name, {
        recursive: node.kind === "directory",
      });

      return moved;
    } catch (error) {
      if (isDestinationCreated) {
        await this.cleanupMove(parent, operation);
      }

      throw error;
    }
  }
  /**
   * Build nodes for a completed copy before committing the move.
   *
   * @param {object} handle - Native file system handle.
   * @param {object} location - Relative path and parent path for the copied handle.
   * @param {Map<string, object>} moved - Destination nodes collected before committing the move.
   */
  async collectCopy(handle, location, moved) {
    moved.set(location.path, {
      handle,
      kind: handle.kind,
      name: handle.name,
      parentPath: location.parentPath,
    });
    if (handle.kind !== "directory") {
      return;
    }

    for await (const child of handle.values()) {
      await this.collectCopy(
        child,
        { path: childPath(location.path, child.name), parentPath: location.path },
        moved,
      );
    }
  }
  /**
   * Remove an unfinished destination without masking the original failure.
   *
   * @param {string|object} parent - Parent path or destination directory handle.
   * @param {object} operation - Paths, handles and callbacks captured before the operation.
   */
  async cleanupMove(parent, operation) {
    try {
      await parent.removeEntry(operation.newName, { recursive: true });
    } catch {
      operation.onCleanupError(operation.newName);
    }
  }
  /**
   * Rename uploaded nodes while preserving their original file snapshots.
   *
   * @param {Array<Array<unknown>>} subtree - Existing node entries below the moved root.
   * @param {string} path - Project-relative file or directory path.
   * @param {string} newPath - Destination path after the move.
   * @returns {Map<string, object>} Remapped uploaded nodes retaining their original snapshots.
   */
  remapSubtree(subtree, path, newPath) {
    const moved = new Map();

    for (const [
      key,
      value,
    ] of subtree) {
      const nextPath = newPath + key.slice(path.length);
      const nextParent = nextPath.includes("/") ? nextPath.slice(0, nextPath.lastIndexOf("/")) : "";
      moved.set(nextPath, { ...value, name: nextPath.split("/").at(-1), parentPath: nextParent });
    }

    return moved;
  }
  /**
   * Delete a node and its descendants after disk removal succeeds.
   *
   * @param {string} path - Project-relative file or directory path.
   * @returns {Promise<Array<string>>} Paths removed from the project after disk removal succeeds.
   */
  async remove(path) {
    const node = this.nodes.get(path);

    if (this.dirHandle) {
      await this.directoryHandle(node.parentPath).removeEntry(node.name, {
        recursive: node.kind === "directory",
      });
    }

    const removed = [];

    for (const key of this.nodes.keys()) {
      if (!belongsTo(key, path)) {
        continue;
      }

      this.nodes.delete(key);
      removed.push(key);
    }

    this.invalidateExclusions();

    return removed;
  }
}
