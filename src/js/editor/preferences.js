const LINE_NUMBERS_KEY = "opennotes.lineNumbers";

/**
 * Read the saved line-number preference, defaulting to hidden.
 *
 * @returns {boolean} Whether line numbers should be visible.
 */
export function loadLineNumbers() {
  try {
    return localStorage.getItem(LINE_NUMBERS_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Persist the preference when browser storage is available.
 *
 * @param {boolean} isVisible - Whether line numbers should be visible.
 */
export function storeLineNumbers(isVisible) {
  try {
    localStorage.setItem(LINE_NUMBERS_KEY, String(isVisible));
  } catch {
    // Keep the toggle working when storage is blocked or full.
  }
}
