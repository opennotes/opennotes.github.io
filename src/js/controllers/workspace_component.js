import { Controller } from "@hotwired/stimulus";

export default class WorkspaceComponent extends Controller {
  static outlets = [
    "workspace",
  ];
  /**
   * Resolve the workspace coordinator attached to the same element.
   *
   * @returns {Controller} Workspace coordinator attached to this element.
   */
  get workspace() {
    return this.workspaceOutlet;
  }
  /**
   * Read the shared project model from the coordinator.
   *
   * @returns {object} Shared project model owned by the workspace.
   */
  get project() {
    return this.workspace.project;
  }
}
