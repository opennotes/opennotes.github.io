const MAX_DIFF_BYTES = 1_048_576;

/**
 * Decode bounded text, refusing binary files and expensive comparisons.
 *
 * @param {object} input - Path and before/after byte buffers.
 * @returns {object} Bounded text versions, or a comparison notice.
 */
export function comparison(input) {
  const { path, before = new Uint8Array(), after = new Uint8Array(), autocrlf } = input;

  if (before.length + after.length > MAX_DIFF_BYTES) {
    return { patch: `${path}: файл слишком большой для текстового diff (лимит 1 МБ).` };
  }

  if (before.includes(0) || after.includes(0)) {
    return { patch: `${path}: двоичный файл изменён.` };
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });

  try {
    const left = decoder.decode(before);
    let right = decoder.decode(after);

    if (autocrlf === true || autocrlf === "true") {
      right = right.replaceAll("\r\n", "\n");
    }

    return {
      path,
      before: left,
      after: right,
    };
  } catch {
    return { patch: `${path}: файл не в UTF-8; текстовый diff недоступен.` };
  }
}
