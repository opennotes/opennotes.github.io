/**
 * Build a decorative icon using the shared outline style.
 *
 * @param {string} type - Icon's semantic category.
 * @param {string} paths - Trusted SVG shapes.
 * @param {string} className - CSS class used by existing controls.
 * @returns {string} Trusted SVG markup.
 */
function icon(type, paths, className = "ico") {
  return `<svg class="${className}" data-file-icon="${type}" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const FOLDER = '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>';
const FILE = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>';

export const ICO = {
  folder: icon("folder", FOLDER),
  dotFolder: icon("dotFolder", `${FOLDER}<circle cx="16" cy="15" r="1" fill="currentColor" stroke="none"/>`),
  file: icon("file", FILE),
  dotFile: icon("dotFile", `${FILE}<circle cx="12" cy="15" r="1" fill="currentColor" stroke="none"/>`),
  md: icon("md", `${FILE}<path d="M8 13h8M8 17h4"/>`),
  code: icon("code", `${FILE}<path d="m10 12-3 3 3 3m4-6 3 3-3 3"/>`),
  markup: icon("markup", '<path d="m7 6-5 6 5 6m10-12 5 6-5 6m-3-14-4 16"/>'),
  style: icon("style", `${FILE}<path d="m10 12-1 7m6-7-1 7M7 14h10M7 17h10"/>`),
  data: icon(
    "data",
    '<path d="M9 3H7a2 2 0 0 0-2 2v4a3 3 0 0 1-2 3 3 3 0 0 1 2 3v4a2 2 0 0 0 2 2h2m6-18h2a2 2 0 0 1 2 2v4a3 3 0 0 0 2 3 3 3 0 0 0-2 3v4a2 2 0 0 1-2 2h-2"/>',
  ),
  config: icon(
    "config",
    '<path d="M3 6h5m4 0h9M3 12h11m4 0h3M3 18h3m4 0h11"/><circle cx="10" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  ),
  git: icon(
    "git",
    '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m12-10a9 9 0 0 1-9 9H6"/>',
  ),
  image: icon(
    "image",
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  ),
  database: icon(
    "database",
    '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  ),
  terminal: icon(
    "terminal",
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  ),
  chevron: icon("chevron", '<path d="m9 6 6 6-6 6"/>', "chevron"),
};
