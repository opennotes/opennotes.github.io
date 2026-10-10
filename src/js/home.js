/**
 * Route installed shortcuts directly to the editor.
 *
 * @param {object} environment - Browser dependencies supplied by the caller.
 */
export function openEditorWhenStandalone(environment = globalThis) {
  const { matchMedia, navigator, document, location } = environment;

  if (!(matchMedia("(display-mode: standalone)").matches || navigator.standalone === true)) {
    return;
  }

  document.documentElement.style.visibility = "hidden";
  location.replace(new URL("edit.html?app=1", location.href));
}
