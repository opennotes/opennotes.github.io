const EXCERPT_BEFORE = 50;
const EXCERPT_AFTER = 100;

/**
 * Rank basename matches before path and content matches.
 *
 * @param {object} node - Project node being read or modified.
 * @param {string} path - Project-relative file or directory path.
 * @param {string} query - Normalized search text.
 * @returns {number} Rank of a basename, path or content match.
 */
function matchScore(node, path, query) {
  if (node.name.toLocaleLowerCase().includes(query)) {
    return 0;
  }

  return path.toLocaleLowerCase().includes(query) ? 1 : 2;
}

/**
 * Read one candidate and return its match or read failure count.
 *
 * @param {string} path - Project-relative file or directory path.
 * @param {object} node - Project node being read or modified.
 * @param {object} options - Options controlling this file operation.
 * @returns {Promise<object>} Optional match and unreadable file count for this candidate.
 */
async function searchNode(path, node, options) {
  let text = "";
  let contentIndex = -1;
  let unreadable = 0;

  try {
    if (options.query) {
      text = await options.readText(path, node);
      contentIndex = text.toLocaleLowerCase().indexOf(options.query);
    }
  } catch {
    unreadable = 1;
  }

  const nameMatch = path.toLocaleLowerCase().includes(options.query);

  if (!nameMatch && contentIndex < 0) {
    return {
      match: null,
      unreadable,
    };
  }

  const from = Math.max(0, contentIndex - EXCERPT_BEFORE);

  const excerpt =
    contentIndex >= 0
      ? text.slice(from, contentIndex + options.query.length + EXCERPT_AFTER).replaceAll(/\s+/g, " ")
      : "";

  const match = { path, excerpt, offset: contentIndex, score: matchScore(node, path, options.query) };

  return {
    match,
    unreadable,
  };
}

/**
 * Search allowed project files and rank matching paths and content.
 *
 * @param {object} project - Shared project model.
 * @param {object} options - Options controlling this file operation.
 * @returns {Promise<object|undefined>} Ranked matches and unreadable count, or undefined after cancellation.
 */
export async function searchProject(project, options) {
  const matches = [];
  let unreadable = 0;

  for (const [
    path,
    node,
  ] of project.nodes) {
    if (!options.isCurrent()) {
      return;
    }

    if (node.kind !== "file" || options.excluded(path)) {
      continue;
    }

    // Check cancellation between reads instead of scheduling the entire project.
    // eslint-disable-next-line no-await-in-loop
    const result = await searchNode(path, node, options);
    unreadable += result.unreadable;
    if (result.match) {
      matches.push(result.match);
    }
  }

  if (!options.isCurrent()) {
    return;
  }

  matches.sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));

  return {
    matches,
    unreadable,
  };
}
