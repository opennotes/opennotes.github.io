/**
 * Reject a stale draft when another application has changed the file.
 *
 * @param {object} handle - Native file system handle.
 * @param {string} expectedText - Contents last read or successfully saved by this session.
 */
async function verifyFileContents(handle, expectedText) {
  const file = await handle.getFile();

  if ((await file.text()) !== expectedText) {
    throw new Error("Файл изменён вне редактора. Автосохранение остановлено. Ваш вариант можно скачать.");
  }
}

/**
 * Write and close a file while preserving the original write failure.
 *
 * @param {object} handle - Native file system handle.
 * @param {string|Blob} contents - Contents to write to the destination file.
 * @param {string} [expectedText] - Session baseline to verify before replacing an existing file.
 */
export async function writeFile(handle, contents, expectedText) {
  if (expectedText !== undefined) {
    await verifyFileContents(handle, expectedText);
  }

  const writable = await handle.createWritable();

  try {
    await writable.write(contents);
    if (expectedText !== undefined) {
      await verifyFileContents(handle, expectedText);
    }

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
