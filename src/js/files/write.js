/**
 * Write and close a file while preserving the original write failure.
 *
 * @param {object} handle - Native file system handle.
 * @param {string|Blob} contents - Contents to write to the destination file.
 */
export async function writeFile(handle, contents) {
  const writable = await handle.createWritable();

  try {
    await writable.write(contents);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      /*
      Preserve the write error.
      */
    }

    throw error;
  }
}
