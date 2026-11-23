import { gitError } from "./filesystem.js";

const SHORT_OID_LENGTH = 8;

/**
 * Read one small repository metadata file without opening working documents.
 *
 * @param {FileSystemDirectoryHandle} directory - Authorized metadata directory.
 * @param {string} name - Metadata filename controlled by this module.
 * @returns {Promise<string>} Original metadata text.
 */
async function readText(directory, name) {
  const handle = await directory.getFileHandle(name);
  const file = await handle.getFile();

  return file.text();
}

/**
 * Resolve a linked worktree beneath a separately granted main repository.
 *
 * @param {FileSystemDirectoryHandle} root - Working folder selected in the editor.
 * @param {FileSystemDirectoryHandle|undefined} main - Main repository selected in the browser.
 * @returns {Promise<object>} Authorized private and shared Git directories.
 */
async function worktree(root, main) {
  const pointerText = await readText(root, ".git");
  const pointer = pointerText.trim().replaceAll("\\", "/");
  const match = /^gitdir: .*\/\.git\/(worktrees\/[^/]+)$/.exec(pointer);

  if (!match) {
    throw gitError(
      "UNSUPPORTED",
      "Служебные данные этого репозитория находятся вне открытой папки. Такой формат Git пока не поддерживается.",
    );
  }

  if (!main) {
    throw gitError(
      "WORKTREE",
      "Это Git worktree. Выберите папку основного репозитория, чтобы браузер получил доступ к общей истории.",
    );
  }

  const common = await main.getDirectoryHandle(".git");
  let gitdir = common;

  const components = match[1].split("/");

  for (const name of components) {
    // Metadata lives below the explicitly selected main repository.
    // eslint-disable-next-line no-await-in-loop
    gitdir = await gitdir.getDirectoryHandle(name);
  }

  const sharedText = await readText(gitdir, "commondir");
  const shared = sharedText.trim();

  if (shared !== "../.." && shared !== "../../") {
    throw gitError("UNSUPPORTED", "Не удалось определить общую историю этого worktree.");
  }

  return {
    root,
    gitdir,
    common,
  };
}

/**
 * Find repository data using only directories explicitly opened by the user.
 *
 * @param {FileSystemDirectoryHandle|null} root - Currently opened native directory.
 * @param {FileSystemDirectoryHandle|undefined} main - Optional main repository for a worktree.
 * @returns {Promise<object>} Repository handle definition for the worker.
 */
export async function gitDirectories(root, main) {
  if (!root) {
    throw gitError(
      "NO_FOLDER",
      "Откройте папку репозитория через «Открыть» в Chrome или Edge. Загрузка отдельных файлов не даёт доступа к истории Git.",
    );
  }

  try {
    const gitdir = await root.getDirectoryHandle(".git");

    return {
      root,
      gitdir,
      common: gitdir,
    };
  } catch (error) {
    if (error.name === "TypeMismatchError") {
      return worktree(root, main);
    }

    if (error.name === "NotFoundError") {
      throw gitError("NOT_REPOSITORY", "В этой папке нет репозитория Git. Откройте его корневую папку.");
    }

    throw error;
  }
}

/**
 * Display the branch immediately without loading the Git processing bundle.
 *
 * @param {object} definition - Authorized repository metadata handles.
 * @returns {Promise<string>} Branch name or detached HEAD description.
 */
export async function gitBranch(definition) {
  const headText = await readText(definition.gitdir, "HEAD");
  const head = headText.trim();

  return head.startsWith("ref: refs/heads/")
    ? head.slice("ref: refs/heads/".length)
    : `detached HEAD · ${head.slice(0, SHORT_OID_LENGTH)}`;
}
