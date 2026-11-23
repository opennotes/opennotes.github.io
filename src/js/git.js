const CONNECTION_KEY = "open-notes-git";

/**
 * Accept only the loopback address and session key printed by our helper.
 *
 * @param {string} value - Connection link pasted or supplied in the fragment.
 * @returns {object} Validated local address and authorization token.
 */
export function parseGitConnection(value) {
  const url = new URL(value);

  if (
    [
      url.protocol !== "http:",
      url.hostname !== "127.0.0.1",
      !url.port,
      url.pathname !== "/",
      url.search,
      url.username,
      url.password,
      !/^#[\da-f]{64}$/.test(url.hash),
    ].some(Boolean)
  ) {
    throw new Error("Вставьте адрес подключения, выведенный помощником Open Notes Git.");
  }

  const token = url.hash.slice(1);
  url.hash = "";

  return {
    base: url.href,
    token,
  };
}

/**
 * Keep the helper key in this tab and remove it from the visible browser URL.
 *
 * @param {object} environment - Browser URL, history and tab storage.
 * @returns {string} Connection to resume, or an empty string.
 */
export function restoreGitConnection(environment = globalThis) {
  const url = new URL(environment.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const link = fragment.get("git");

  if (link) {
    fragment.delete("git");
    url.hash = fragment.toString();
    environment.history.replaceState(null, "", url);

    return link;
  }

  try {
    return environment.sessionStorage.getItem(CONNECTION_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * Remember a helper only for this browser tab, tolerating restricted storage.
 *
 * @param {string} value - Validated link, or empty text to forget it.
 */
export function rememberGitConnection(value) {
  try {
    if (value) {
      sessionStorage.setItem(CONNECTION_KEY, value);

      return;
    }

    sessionStorage.removeItem(CONNECTION_KEY);
  } catch {
    /*
    Connecting still works when tab storage is disabled.
    */
  }
}

/**
 * Read a bounded Git response without sending credentials or following redirects.
 *
 * @param {object} connection - Validated local helper address and key.
 * @param {string} route - Git endpoint and query string.
 * @param {AbortSignal} signal - Cancellation signal owned by the active view.
 * @returns {Promise<object>} Git data or a user-facing failure.
 */
export async function requestGit(connection, route, signal) {
  let response;

  try {
    response = await fetch(new URL(route, connection.base), {
      headers: { Authorization: `Bearer ${connection.token}` },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      targetAddressSpace: "loopback",
      signal,
    });
  } catch (error) {
    throw new Error(
      "Нет связи с Git. Проверьте, что помощник запущен, и разрешите доступ к локальному компьютеру в настройках сайта.",
      { cause: error },
    );
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error);
  }

  return data;
}
