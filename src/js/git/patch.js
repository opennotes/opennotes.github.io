import { createTwoFilesPatch } from "diff";

const MAX_DIFF_BYTES = 1_048_576;
const DIFF_TIMEOUT = 1500;

/**
 * Decode bounded text, refusing binary files and expensive comparisons.
 *
 * @param {object} input - Path and before/after byte buffers.
 * @returns {object} Text versions and a unified patch, or a comparison notice.
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

    const patch =
      createTwoFilesPatch(`a/${path}`, `b/${path}`, left, right, "", "", { timeout: DIFF_TIMEOUT }) ??
      `${path}: сравнение слишком сложное для просмотра в браузере.`;

    return {
      path,
      before: left,
      after: right,
      patch,
    };
  } catch {
    return { patch: `${path}: файл не в UTF-8; текстовый diff недоступен.` };
  }
}
