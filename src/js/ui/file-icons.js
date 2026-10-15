import { ICO } from "./icons.js";

const EXTENSION_GROUPS = Object.entries({
  md: "md markdown mdx",
  code: "js jsx mjs cjs ts tsx mts cts php phtml py rb go rs swift c h cpp hpp cs java kt kts vue svelte",
  markup: "html htm xhtml xml xsl xslt",
  style: "css scss sass less",
  data: "json jsonc json5 yaml yml toml csv tsv",
  config: "ini cfg conf config properties",
  image: "png jpg jpeg gif webp svg ico avif bmp heic tiff tif",
  database: "sql sqlite sqlite3 db",
  terminal: "sh bash zsh fish bat cmd ps1",
});

const EXTENSIONS = new Map();

for (const [
  type,
  extensions,
] of EXTENSION_GROUPS) {
  for (const extension of extensions.split(" ")) {
    EXTENSIONS.set(extension, type);
  }
}

const GIT_FILES = new Set([
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".gitkeep",
]);

const CONFIG_FILES = new Set([
  ".editorconfig",
  ".npmrc",
  ".yarnrc",
  ".prettierrc",
  ".eslintrc",
  ".babelrc",
  "dockerfile",
  "containerfile",
]);

const TASK_FILES = new Set([
  "makefile",
  "gnumakefile",
  "justfile",
  ".bashrc",
  ".zshrc",
  ".profile",
]);

/**
 * Classify by known filename first, then format, preserving unknown file types.
 *
 * @param {object} node - File or directory name and kind.
 * @returns {string} Key in the shared icon set.
 */
export function fileIconType(node) {
  const name = node.name.toLowerCase();
  const isDot = name.startsWith(".");

  if (node.kind === "directory") {
    return isDot ? "dotFolder" : "folder";
  }

  if (GIT_FILES.has(name)) {
    return "git";
  }

  if (CONFIG_FILES.has(name) || name === ".env" || name.startsWith(".env.")) {
    return "config";
  }

  if (TASK_FILES.has(name)) {
    return "terminal";
  }

  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";

  return EXTENSIONS.get(extension) || (isDot ? "dotFile" : "file");
}

/**
 * Render trusted icons without interpolating user-controlled filenames.
 *
 * @param {object} node - File or directory name and kind.
 * @returns {string} Decorative SVG and tree alignment markup.
 */
export function nodeIcon(node) {
  const prefix = node.kind === "directory" ? ICO.chevron : '<span class="spacer" aria-hidden="true"></span>';

  return prefix + ICO[fileIconType(node)];
}
