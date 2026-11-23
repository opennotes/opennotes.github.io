import { createTwoFilesPatch } from "diff";

const MAX_DIFF_BYTES = 1_048_576;
const DIFF_TIMEOUT = 1500;

/**
 * Decode bounded text, refusing binary files and expensive comparisons.
 *
 * @param {object} input - Path and before/after byte buffers.
 * @returns {string} Unified diff or a clear unsupported-comparison message.
 */
export function comparison(input) {
  const { path, before = new Uint8Array(), after = new Uint8Array(), autocrlf } = input;

  if (before.length + after.length > MAX_DIFF_BYTES) {
    return `${path}: файл слишком большой для текстового diff (лимит 1 МБ).`;
  }

  if (before.includes(0) || after.includes(0)) {
    return `${path}: двоичный файл изменён.`;
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });

  try {
    const left = decoder.decode(before);
    let right = decoder.decode(after);

    if (autocrlf === true || autocrlf === "true") {
      right = right.replaceAll("\r\n", "\n");
    }

    return (
      createTwoFilesPatch(`a/${path}`, `b/${path}`, left, right, "", "", { timeout: DIFF_TIMEOUT }) ??
      `${path}: сравнение слишком сложное для просмотра в браузере.`
    );
  } catch {
    return `${path}: файл не в UTF-8; текстовый diff недоступен.`;
  }
}
