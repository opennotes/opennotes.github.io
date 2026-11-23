import * as git from "isomorphic-git";

import { GitFileSystem } from "./filesystem.js";
import { gitBranch } from "./metadata.js";
import { comparison } from "./patch.js";

const PAGE_SIZE = 30;
const STATUS_MODIFIED = 3;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const SECONDS = 1000;
const SYMLINK_MODE = 0o12_0000;

/**
 * Read repository objects through an explicitly granted, read-only filesystem.
 */
export class Repo {
  /**
   * Keep one object cache for the lifetime of an open Git view.
   *
   * @param {object} definition - Working, private and shared directory handles.
   */
  constructor(definition) {
    this.definition = definition;
    this.options = { fs: new GitFileSystem(definition), dir: "/repo", cache: {} };
  }
  /**
   * Resolve HEAD, including a repository without its first commit.
   *
   * @returns {Promise<string>} Current object identifier or empty text.
   */
  async head() {
    try {
      return await git.resolveRef({ ...this.options, ref: "HEAD" });
    } catch (error) {
      if (error.code === "NotFoundError") {
        return "";
      }

      throw error;
    }
  }
  /**
   * Read one bounded history page from the current HEAD.
   *
   * @param {number} skip - Number of already displayed commits.
   * @returns {Promise<object>} Commit summaries and continuation state.
   */
  async history(skip = 0) {
    const head = await this.head();
    const entries = head ? await git.log({ ...this.options, ref: head, depth: skip + PAGE_SIZE + 1 }) : [];

    const commits = entries.slice(skip, skip + PAGE_SIZE).map(({ oid, commit }) => ({
      oid,
      author: commit.author.name,
      date: new Date(commit.author.timestamp * SECONDS).toISOString(),
      subject: commit.message.split("\n", 1)[0],
    }));

    return {
      commits,
      more: entries.length > skip + PAGE_SIZE,
    };
  }
  /**
   * Compare saved files with HEAD and the index, keeping failures visible.
   *
   * @returns {Promise<object>} Branch, independent staged/working changes and history.
   */
  async repository() {
    const branch = await gitBranch(this.definition);
    const history = await this.history();

    try {
      const excluded = await this.excluded();

      const rows = await git.statusMatrix({
        ...this.options,
        refresh: false,
        filter: (path) => excluded.every((entry) => !(path === entry || path.startsWith(`${entry}/`))),
      });

      const changes = rows.filter((row) => isChanged(row)).map((row) => status(row));

      return {
        root: this.definition.root.name,
        branch,
        ...history,
        changes,
        warning:
          excluded.length > 0
            ? "Символические ссылки и подмодули исключены из списка изменений: браузер не предоставляет их содержимое."
            : "",
      };
    } catch (error) {
      return {
        root: this.definition.root.name,
        branch,
        ...history,
        changes: null,
        warning: `Список изменений недоступен: ${error.message}`,
      };
    }
  }
  /**
   * Avoid mistaking browser-inaccessible links and submodules for deleted files.
   *
   * @returns {Promise<Array<string>>} Paths excluded from working comparisons.
   */
  async excluded() {
    const head = await this.head();

    const entries = await git.walk({
      ...this.options,
      trees: [
        git.TREE({ ref: head || EMPTY_TREE }),
        git.STAGE(),
      ],
      map: async (path, items) => {
        const modes = await Promise.all(items.map((entry) => entry?.mode()));

        return modes.some((mode) => mode >= SYMLINK_MODE) ? path : undefined;
      },
    });

    return entries.filter(Boolean);
  }
  /**
   * Read the exact blob stored in a commit or index without changing the index.
   *
   * @param {string} path - Literal repository-relative file path.
   * @param {string} ref - Commit identifier, HEAD or index selector.
   * @returns {Promise<Uint8Array>} Stored bytes, or empty bytes for a missing file.
   */
  async blob(path, ref) {
    if (!ref) {
      return new Uint8Array();
    }

    let oid;
    await git.walk({
      ...this.options,
      trees: [
        ref === "INDEX" ? git.STAGE() : git.TREE({ ref }),
      ],
      map: async (
        filepath,
        [
          entry,
        ],
      ) => {
        if (filepath === path) {
          oid = await entry.oid();
        }

        return filepath === "." || path.startsWith(`${filepath}/`);
      },
    });
    if (!oid) {
      return new Uint8Array();
    }

    const { blob } = await git.readBlob({ ...this.options, oid });

    return blob;
  }
  /**
   * Read saved working bytes; deleted files have no right-hand contents.
   *
   * @param {string} path - Literal repository-relative file path.
   * @returns {Promise<Uint8Array>} Working bytes or an empty deletion side.
   */
  async working(path) {
    try {
      return await this.options.fs.readFile(`/repo/${path}`);
    } catch (error) {
      if (error.code === "ENOENT") {
        return new Uint8Array();
      }

      throw error;
    }
  }
  /**
   * Compare HEAD to index, or index to saved working contents.
   *
   * @param {object} selection - Literal path and comparison area.
   * @returns {Promise<object>} Bounded text patch or explicit binary notice.
   */
  async diff(selection) {
    const { path, area } = selection;
    const isStaged = area === "staged";
    const head = await this.head();
    const before = await this.blob(path, isStaged ? head : "INDEX");
    const after = isStaged ? await this.blob(path, "INDEX") : await this.working(path);
    const autocrlf = await git.getConfig({ ...this.options, path: "core.autocrlf" });

    return { patch: comparison({ path, before, after, autocrlf }) };
  }
  /**
   * Compare a commit with its first parent, including the initial commit.
   *
   * @param {string} oid - Selected immutable commit identifier.
   * @returns {Promise<object>} Combined patches for all changed blobs.
   */
  async commit(oid) {
    const { commit } = await git.readCommit({ ...this.options, oid });
    const parent = commit.parent[0] || EMPTY_TREE;

    const patches = await git.walk({
      ...this.options,
      trees: [
        git.TREE({ ref: parent }),
        git.TREE({ ref: oid }),
      ],
      map: (
        path,
        [
          before,
          after,
        ],
      ) => this.commitFile(path, { before, after }),
    });

    return { patch: patches.filter(Boolean).join("\n") };
  }
  /**
   * Skip equal objects and directories while comparing the selected commit.
   *
   * @param {string} path - Repository-relative tree entry.
   * @param {object} entries - Optional before and after walker entries.
   * @returns {Promise<string|undefined>} Literal unified patch for one changed blob.
   */
  async commitFile(path, entries) {
    const { before, after } = entries;

    if (path === "." || (await before?.oid()) === (await after?.oid())) {
      return;
    }

    const type = (await after?.type()) || (await before?.type());

    if (type === "tree") {
      return;
    }

    if (type !== "blob") {
      return `${path}: содержимое подмодуля не сравнивается.\n`;
    }

    return comparison({ path, before: await before?.content(), after: await after?.content() });
  }
}

/**
 * Translate the Git status matrix into independent index and working changes.
 *
 * @param {Array} row - Path, HEAD, working and stage identity codes.
 * @returns {object} Literal path and conventional status letters.
 */
function status(row) {
  const [
    path,
    head,
    work,
    stage,
  ] = row;

  if (!head && !stage) {
    return {
      path,
      staged: "?",
      working: " ",
    };
  }

  let staged = " ";
  let working = " ";

  if (stage !== head) {
    staged = stage ? "M" : "D";
  }

  if (stage && !head) {
    staged = "A";
  }

  if (work !== stage || stage === STATUS_MODIFIED) {
    working = work ? "M" : "D";
  }

  return {
    path,
    staged,
    working,
  };
}

/**
 * Detect independent changes against HEAD and the index.
 *
 * @param {Array} row - Git status matrix entry.
 * @returns {boolean} Whether either comparison has changed.
 */
function isChanged(row) {
  const [
    ,
    head,
    work,
    stage,
  ] = row;

  return head !== work || head !== stage;
}
