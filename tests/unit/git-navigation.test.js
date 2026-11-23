import { expect, it, vi } from "vitest";

import { fileRow, navigateRows, selectRow } from "../../src/js/git/navigation.js";

it("renders literal filenames, directory context and independent Git status", () => {
  const row = fileRow({ path: "docs/<img>.md", status: "M" }, "git#selectChange");
  expect(row.querySelector(".git-file-name").textContent).toBe("<img>.md");
  expect(row.querySelector("small").textContent).toBe("docs");
  expect(row.dataset.status).toBe("M");
  expect(row.querySelector("img")).toBeNull();
  const root = fileRow({ path: "README.md" }, "git#commitFile");
  expect(root.querySelector("small").textContent).toBe("");
  expect(root.dataset.status).toBe("");
});

it("keeps the selected row marked when keyboard focus moves elsewhere", () => {
  const list = document.createElement("div");
  const first = fileRow({ path: "first.md" }, "git#selectChange");
  const second = fileRow({ path: "second.md" }, "git#selectChange");
  list.append(first, second);
  selectRow(list, second);
  expect(second.getAttribute("aria-current")).toBe("true");
  expect(first.getAttribute("aria-current")).toBe("false");
  expect(second.tabIndex).toBe(0);
  expect(first.tabIndex).toBe(-1);
  selectRow(list, null);
  expect(first.tabIndex).toBe(0);
});

it("navigates file rows with arrows without leaving the list bounds", () => {
  const list = document.createElement("div");
  const first = fileRow({ path: "first.md" }, "git#selectChange");
  const second = fileRow({ path: "second.md" }, "git#selectChange");
  list.append(first, second);
  document.body.append(list);
  list.addEventListener("keydown", navigateRows);
  const clicked = vi.fn();
  second.addEventListener("click", clicked);
  first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(second);
  expect(clicked).toHaveBeenCalledOnce();
  second.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(second);
  second.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(first);
  first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(first);
  const unrelated = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
  first.dispatchEvent(unrelated);
  expect(unrelated.defaultPrevented).toBe(false);
  list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
});
