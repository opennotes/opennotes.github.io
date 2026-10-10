import { writeFile } from "../files/write.js";

/**
 * Write newer drafts in order while the session remains active.
 *
 * @param {object} session - Active document persistence session.
 * @param {object} callbacks - Session ownership, draft reading and status callbacks.
 * @returns {Promise<boolean>} Whether the active session finished writing successfully.
 */
async function flushSession(session, callbacks) {
  try {
    while (callbacks.isCurrent()) {
      const text = callbacks.readText();

      if (text === null || text === session.savedText) {
        break;
      }

      callbacks.onSaving();
      // Writes must finish in order so an older draft cannot overwrite a newer one.
      // eslint-disable-next-line no-await-in-loop
      await writeFile(session.handle, text);
      session.savedText = text;
      callbacks.onWritten();
    }

    if (callbacks.isCurrent()) {
      callbacks.onComplete();
    }

    return true;
  } catch (error) {
    if (callbacks.isCurrent()) {
      callbacks.onError(error);
    }

    return false;
  }
}

/**
 * Serialize writes until the active session draft is fully persisted.
 *
 * @param {object} session - Active document persistence session.
 * @param {object} callbacks - Session ownership, draft reading and status callbacks.
 * @returns {Promise<boolean>} Whether the serialized writes completed successfully.
 */
export async function saveSession(session, callbacks) {
  if (session.promise) {
    return session.promise;
  }

  session.promise = flushSession(session, callbacks);
  try {
    return await session.promise;
  } finally {
    session.promise = null;
  }
}
