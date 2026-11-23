/* eslint security/detect-non-literal-fs-filename: "off" -- Only disposable test fixture paths are used. */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export function nativeGit(root, args) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- Git is the independent test oracle, never an application dependency.
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

export async function gitFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "opennotes-browser-git-"));
  nativeGit(root, ["init", "-b", "main"]);
  nativeGit(root, ["config", "user.name", "Test Author"]);
  nativeGit(root, ["config", "user.email", "test@example.test"]);
  nativeGit(root, ["config", "maintenance.auto", "false"]);
  nativeGit(root, ["config", "gc.auto", "0"]);
  await writeFile(path.join(root, "note.md"), "before\n");
  await writeFile(path.join(root, "deleted.md"), "gone\n");
  await writeFile(path.join(root, ".gitignore"), "ignored.txt\n");
  nativeGit(root, ["add", "."]);
  nativeGit(root, ["commit", "-m", "Initial notes"]);
  nativeGit(root, ["repack", "-ad"]);
  nativeGit(root, ["prune-packed"]);
  const oid = nativeGit(root, ["rev-parse", "HEAD"]);
  await writeFile(path.join(root, "note.md"), "staged\n");
  nativeGit(root, ["add", "note.md"]);
  await writeFile(path.join(root, "note.md"), "working\n");
  await writeFile(path.join(root, "new note.md"), "new note\n");
  await writeFile(path.join(root, "ignored.txt"), "ignored\n");
  await unlink(path.join(root, "deleted.md"));
  return {
    root,
    oid,
  };
}

export async function fixtureFiles(root) {
  const files = [];
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith(".lock")) {
      continue;
    }
    const filename = path.join(entry.parentPath, entry.name);
    // eslint-disable-next-line no-await-in-loop -- Test fixture serialization only.
    const bytes = await readFile(filename);
    files.push({ path: path.relative(root, filename), bytes: bytes.toString("base64") });
  }
  return files;
}

export async function removeFixture(root) {
  await rm(root, { recursive: true, force: true });
}

export async function storeGitFolder(page, files) {
  await page.evaluate(async (entries) => {
    const storage = await navigator.storage.getDirectory();
    const root = await storage.getDirectoryHandle(`notes-${crypto.randomUUID()}`, { create: true });
    for (const entry of entries) {
      const parts = entry.path.split("/");
      const name = parts.pop();
      let folder = root;
      for (const part of parts) {
        // eslint-disable-next-line no-await-in-loop -- Each fixture handle depends on its parent.
        folder = await folder.getDirectoryHandle(part, { create: true });
      }
      // eslint-disable-next-line no-await-in-loop -- OPFS fixture population is sequential.
      const file = await folder.getFileHandle(name, { create: true });
      // eslint-disable-next-line no-await-in-loop -- OPFS fixture population is sequential.
      const writer = await file.createWritable();
      // eslint-disable-next-line no-await-in-loop -- OPFS fixture population is sequential.
      await writer.write(Uint8Array.from(atob(entry.bytes), (character) => character.codePointAt(0)));
      // eslint-disable-next-line no-await-in-loop -- OPFS fixture population is sequential.
      await writer.close();
    }
    globalThis.showDirectoryPicker = async () => root;
    globalThis.showOpenFilePicker = async () => [];
    globalThis.gitTestFolder = root;
  }, files);
}

export async function openGitFolder(page, files) {
  await page.locator('.app[data-ready="true"]').waitFor();
  await storeGitFolder(page, files);
  await page.locator('[data-action="workspace#toggleOpenMenu"]').click();
  await page.getByRole("button", { name: "Папку…", exact: true }).click();
}
