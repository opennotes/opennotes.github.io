/**
 * Build compact file rows with a readable basename and its directory context.
 *
 * @param {object} file - Literal path and optional Git status letter.
 * @param {string} action - Controller action selected by this module's callers.
 * @returns {HTMLButtonElement} Safe file navigation row.
 */
export function fileRow(file, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "git-file";
  button.dataset.action = action;
  button.dataset.path = file.path;
  button.title = file.path;
  const parts = file.path.split("/");
  const name = document.createElement("span");
  name.className = "git-file-name";
  name.textContent = parts.pop();
  const directory = document.createElement("small");
  directory.textContent = parts.join("/");
  const status = document.createElement("span");
  status.className = "git-file-status";
  status.textContent = file.status || "";
  button.dataset.status = file.status || "";
  button.append(name, directory, status);

  return button;
}

/**
 * Keep selected rows visibly selected after keyboard focus moves into the diff.
 *
 * @param {HTMLElement} container - A single file or commit list.
 * @param {HTMLButtonElement|null} selected - Row matching the displayed comparison.
 */
export function selectRow(container, selected) {
  const buttons = container.querySelectorAll("button");

  for (const [
    index,
    button,
  ] of buttons.entries()) {
    const isSelected = button === selected;
    button.setAttribute("aria-current", String(isSelected));
    const isTabStop = isSelected || (!selected && index === 0);
    button.tabIndex = isTabStop ? 0 : -1;
  }
}

/**
 * Let file and history lists behave like editor navigation lists with arrow keys.
 *
 * @param {KeyboardEvent} event - Keyboard input from a navigation list.
 */
export function navigateRows(event) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }

  const buttons = [
    ...event.currentTarget.querySelectorAll("button:not([hidden])"),
  ];

  const index = buttons.indexOf(event.target.closest("button"));

  if (index === -1) {
    return;
  }

  event.preventDefault();
  const step = event.key === "ArrowDown" ? 1 : -1;
  const next = buttons[Math.max(0, Math.min(buttons.length - 1, index + step))];
  next.focus();
  next.click();
}
