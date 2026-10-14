import { undo } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";

import { mount, fileHandle, directory, project } from "../support/workspace.js";

let c, app;
beforeEach(async () => {
  ({ c, app } = await mount());
});
afterEach(() => {
  app.unload("workspace", "tree", "editor", "search");
  app.stop();
});
const event = (extra = {}) => ({ preventDefault: vi.fn(), ...extra });
const fallback = (handle) => ({ ...handle, createWritable: undefined, queryPermission: undefined });
async function open(content = "Alpha") {
  await project(c, directory("Notes", [fileHandle("A.md", content), fileHandle("B.md", "Beta")]));
  await c.openNode("A.md");
}
describe("Saving and formatting", () => {
  it("does not write unchanged files", async () => {
    await open();
    const write = vi.spyOn(c.project.fileHandle, "createWritable");
    expect(await c.editor.save()).toBe(true);
    c.editor.scheduleSave();
    expect(write).not.toHaveBeenCalled();
    expect(c.statusTextTarget.textContent).toBe("Открыт");
  });
  it("saves edits and invalidates cached text", async () => {
    await open();
    c.editor.view.dispatch({ changes: { from: 5, insert: " changed" } });
    expect(await c.editor.save()).toBe(true);
    const awaitedResult8 = await c.project.fileHandle.getFile();
    expect(await awaitedResult8.text()).toBe("Alpha changed");
    expect(c.project.nodes.get("A.md").searchCache).toBeNull();
  });
  it("schedules one debounced save and refreshes open search", async () => {
    await open();
    vi.useFakeTimers();
    c.search.searchDialogTarget.open = true;
    c.editor.view.dispatch({ changes: { from: 5, insert: " changed" } });
    await vi.advanceTimersByTimeAsync(600);
    const awaitedResult9 = await c.project.fileHandle.getFile();
    expect(await awaitedResult9.text()).toBe("Alpha changed");
    expect(c.search.searchInfoTarget.textContent).not.toBe("");
  });
  it("tracks fallback edits and handles an absent node", async () => {
    await open();
    c.project.fileHandle = fallback(c.project.fileHandle);
    c.editor.view.dispatch({ changes: { from: 5, insert: " changed" } });
    expect(c.project.nodes.get("A.md").text).toBe("Alpha changed");
    c.project.nodes.delete("A.md");
    c.editor.scheduleSave();
    expect(c.statusTextTarget.textContent).toBe("Нужно скачать");
  });
  it("keeps unsaved text after a write or abort failure", async () => {
    await open();
    c.editor.view.dispatch({ changes: { from: 5, insert: " keep" } });
    c.project.fileHandle.createWritable = async () => ({
      write: async () => {
        throw new Error("disk");
      },
      abort: async () => {
        throw new Error("abort");
      },
    });
    expect(await c.editor.save()).toBe(false);
    expect(c.editor.view.state.doc.toString()).toBe("Alpha keep");
    expect(c.toastTarget.textContent).toBe("disk");
  });
  it("supports a successful abort after a failed close", async () => {
    await open();
    c.editor.view.dispatch({ changes: { from: 5, insert: " keep" } });
    const abort = vi.fn();
    c.project.fileHandle.createWritable = async () => ({
      write: async () => {},
      close: async () => {
        throw new Error("close");
      },
      abort,
    });
    expect(await c.editor.save()).toBe(false);
    expect(abort).toHaveBeenCalled();
  });
  it("does not save absent editor or non-writable sessions", async () => {
    expect(await c.editor.save()).toBe(true);
    await open();
    c.editor.editorSession = null;
    expect(await c.editor.save()).toBe(true);
    c.editor.editorSession = { handle: {}, savedText: "" };
    expect(await c.editor.save()).toBe(true);
  });
  it("shares concurrent saves and writes newer edits", async () => {
    await open();
    let release;
    const base = c.project.fileHandle.createWritable;
    c.project.fileHandle.createWritable = async () => {
      await new Promise((resolve) => {
        release = resolve;
      });
      return base();
    };
    c.editor.view.dispatch({ changes: { from: 5, insert: " one" } });
    const first = c.editor.save(),
      second = c.editor.save();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const firstRelease = release;
    c.editor.view.dispatch({ changes: { from: 9, insert: " two" } });
    firstRelease();
    await vi.waitFor(() => expect(release).not.toBe(firstRelease));
    release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    const awaitedResult10 = await c.project.fileHandle.getFile();
    expect(await awaitedResult10.text()).toBe("Alpha one two");
  });
  it.each([
    ["headingOne", "# "],
    ["headingTwo", "## "],
    ["headingThree", "### "],
    ["quote", "> "],
    ["list", "- "],
    ["orderedList", "1. "],
  ])("toggles %s prefixes", (method, prefix) => {
    c.project.fileHandle = { name: "Draft.md" };
    c.editor.showEditor("one\ntwo");
    c.editor.view.dispatch({ selection: { anchor: 0, head: 7 } });
    c.editor[method]();
    expect(c.editor.view.state.doc.toString()).toBe(`${prefix}one\n${prefix}two`);
    c.editor.view.dispatch({ selection: { anchor: 0, head: c.editor.view.state.doc.length } });
    c.editor[method]();
    expect(c.editor.view.state.doc.toString()).toBe("one\ntwo");
  });
  it.each([
    ["bold", "**жирный**"],
    ["italic", "*курсив*"],
    ["link", "[текст](https://)"],
    ["code", "```\n\n```"],
  ])("inserts %s formatting", (method, expected) => {
    c.project.fileHandle = { name: "Draft.md" };
    c.editor.showEditor("");
    c.editor[method]();
    expect(c.editor.view.state.doc.toString()).toBe(expected);
  });
  it("wraps a selection and prevents losing it on toolbar mousedown", () => {
    c.project.fileHandle = { name: "Draft.md" };
    c.editor.showEditor("selected");
    c.editor.view.dispatch({ selection: { anchor: 0, head: 8 } });
    c.editor.bold();
    expect(c.editor.view.state.doc.toString()).toBe("**selected**");
    const keyboardEvent = event({ button: 0, target: c.editor.toolbarTarget.querySelector(".tool-btn") });
    c.editor.keepEditorSelection(keyboardEvent);
    expect(keyboardEvent.preventDefault).toHaveBeenCalled();
    const outside = event({ button: 0, target: document.body });
    c.editor.keepEditorSelection(outside);
    expect(outside.preventDefault).not.toHaveBeenCalled();
    c.editor.keepEditorSelection(event({ button: 1, target: document.body }));
  });
  it("ignores formatting with no editor or while busy", () => {
    c.editor.bold();
    c.editor.headingOne();
    c.project.fileHandle = { name: "Draft.md" };
    c.editor.showEditor("a");
    c.project.operationBusy = true;
    c.editor.bold();
    c.editor.headingOne();
    expect(c.editor.view.state.doc.toString()).toBe("a");
  });
});

describe("File syntax and formatting controls", () => {
  it.each([
    ["App.PHP", '<?php echo "hello";'],
    ["style.css", "body { color: red; }"],
    ["app.js", "const answer = 42;"],
    ["index.html", '<h1 class="title">Hello</h1>'],
    ["query.sql", "SELECT name FROM users WHERE id = 1;"],
  ])("opens %s with syntax and disables Markdown actions", async (name, text) => {
    await project(c, directory("Code", [fileHandle(name, text)]));
    await c.openNode(name);
    expect(syntaxTree(c.editor.view.state)).toHaveLength(text.length);
    expect(syntaxTree(c.editor.view.state).topNode.firstChild).not.toBeNull();
    expect(c.editor.toolbarTarget.querySelectorAll(".tool-btn:disabled")).toHaveLength(10);
    c.editor.bold();
    c.editor.headingOne();
    expect(c.editor.view.state.doc.toString()).toBe(text);
    expect(c.editor.editorTarget.querySelector(".cm-md-heading-1")).toBeNull();
    c.editor.view.dispatch({ changes: { from: text.length, insert: "\n" } });
    expect(await c.editor.save()).toBe(true);
    const file = await c.project.fileHandle.getFile();
    expect(await file.text()).toBe(`${text}\n`);
  });

  it("switches back to Markdown and updates syntax after renaming without losing history", async () => {
    await project(c, directory("Notes", [fileHandle("A.md", "# Heading"), fileHandle("B.js", "let x = 1;")]));
    await c.openNode("B.js");
    await c.openNode("A.md");
    expect(c.editor.toolbarTarget.querySelectorAll(".tool-btn:disabled")).toHaveLength(0);
    c.editor.bold();
    const text = c.editor.view.state.doc.toString();
    const node = c.project.nodes.get("A.md");
    node.name = "A.js";
    c.project.nodes.set("A.js", node);
    c.project.currentPath = "A.js";
    c.editor.refreshFileName();
    expect(c.editor.view.state.doc.toString()).toBe(text);
    expect(c.editor.toolbarTarget.querySelectorAll(".tool-btn:disabled")).toHaveLength(10);
    expect(c.editor.editorTarget.querySelector(".cm-md-heading-1")).toBeNull();
    undo(c.editor.view);
    expect(c.editor.view.state.doc.toString()).toBe("# Heading");
  });

  it("treats unknown extensions as plain text", async () => {
    await project(c, directory("Notes", [fileHandle("notes.txt", "# Plain text")]));
    await c.openNode("notes.txt");
    expect(syntaxTree(c.editor.view.state)).toHaveLength(0);
    expect(c.editor.toolbarTarget.querySelectorAll(".tool-btn:disabled")).toHaveLength(10);
    expect(c.editor.editorTarget.querySelector(".cm-md-heading-1")).toBeNull();
  });
});

it("keeps unnamed drafts in plain text with formatting disabled", () => {
  c.editor.showEditor("draft");
  c.editor.bold();
  c.editor.headingOne();
  expect(c.editor.view.state.doc.toString()).toBe("draft");
  expect(c.editor.toolbarTarget.querySelectorAll(".tool-btn:disabled")).toHaveLength(10);
});
