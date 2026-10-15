import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// WebKit's directory chooser omits dot entries. Supply the complete fixture FileList
// through the same input event so icon coverage does not depend on the OS chooser.
export async function uploadTextProject(page, folder) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The caller supplies a local test fixture directory.
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filename = path.join(entry.parentPath, entry.name);
        return {
          name: entry.name,
          relativePath: `${path.basename(folder)}/${path.relative(folder, filename).split(path.sep).join("/")}`,
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- Paths come only from enumerating the fixture directory.
          text: await readFile(filename, "utf8"),
        };
      }),
  );
  await page.evaluate((fixtures) => {
    const transfer = new DataTransfer();
    for (const fixture of fixtures) {
      const file = new File([fixture.text], fixture.name, { type: "text/plain" });
      Object.defineProperty(file, "webkitRelativePath", { value: fixture.relativePath });
      transfer.items.add(file);
    }
    const input = document.querySelector('[data-workspace-target="directoryInput"]');
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, files);
}
