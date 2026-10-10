import EditorController from "./editor_controller.js";
import SearchController from "./search_controller.js";
import TreeController from "./tree_controller.js";
import WorkspaceController from "./workspace_controller.js";

export const controllers = {
  tree: TreeController,
  editor: EditorController,
  search: SearchController,
  workspace: WorkspaceController,
};
