/**
 * Apply ordered ignore scopes to one path prefix.
 *
 * @param {string} prefix - Markdown marker or relative path prefix.
 * @param {boolean} isDirectory - Whether the selected workspace is a folder.
 * @param {Array<object>} scopes - Ordered root and nested ignore scopes.
 * @returns {boolean} Whether the final matching scope excludes this prefix.
 */
function ignoredByScopes(prefix, isDirectory, scopes) {
  let isIgnored = false;

  for (const { base, matcher } of scopes) {
    if (base && !prefix.startsWith(base)) {
      continue;
    }

    const relative = prefix.slice(base.length);

    if (!relative) {
      continue;
    }

    const result = matcher.test(relative + (isDirectory ? "/" : ""));

    if (result.ignored) {
      isIgnored = true;
      continue;
    }

    if (result.unignored) {
      isIgnored = false;
    }
  }

  return isIgnored;
}

/**
 * Build an exclusion predicate from ordered Git ignore scopes.
 *
 * @param {Array<object>} scopes - Ordered root and nested ignore scopes.
 * @returns {(...args: unknown[]) => unknown} Predicate checking a path against ordered ignore scopes.
 */
export function projectExclusions(scopes) {
  return (path, kind = "file") => {
    if (!path) {
      return false;
    }

    const parts = path.split("/");

    if (parts.includes(".git")) {
      return true;
    }

    for (let index = 0; index < parts.length; index++) {
      const prefix = parts.slice(0, index + 1).join("/");
      const isDirectory = index < parts.length - 1 || kind === "directory";

      if (ignoredByScopes(prefix, isDirectory, scopes)) {
        return true;
      }
    }

    return false;
  };
}
