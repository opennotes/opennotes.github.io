import { readFileSync } from "node:fs";

import { Application } from "@hotwired/stimulus";

import { controllers } from "../../src/js/controllers/index.js";

export const html = readFileSync("src/edit.html", "utf8");
export async function mount() {
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const app = Application.start();
  app.handleError = (error, message) => {
    throw new Error(`${message}: ${error.stack}`);
  };
  for (const [name, controller] of Object.entries(controllers)) {
    app.register(name, controller);
  }
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  return {
    app,
    c: app.getControllerForElementAndIdentifier(
      document.querySelector('[data-controller~="workspace"]'),
      "workspace",
    ),
  };
}
export { fileHandle, directory } from "./files.js";
export async function project(c, root) {
  c.editor.closeEditor();
  c.project.nodes.clear();
  c.project.dirHandle = root;
  c.project.workspaceIsDirectory = true;
  await c.project.scanDirectory(root, "");
  c.prepareTree();
  c.tree.renderTree();
}
