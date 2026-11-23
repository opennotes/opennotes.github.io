import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { devNull } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const PAGE_SIZE = 30;
const MAX_CONCURRENT_REQUESTS = 4;

// Keep Git's configured diff commands and fsmonitor programs out of HTTP reads.
export async function runGit(root, args, acceptedCodes = []) {
  try {
    const result = await execute(
      "git",
      [
        "--no-pager",
        "--no-optional-locks",
        "--literal-pathspecs",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.quotePath=false",
        "-c",
        "color.ui=false",
        "-C",
        root,
        ...args,
      ],
      { encoding: "utf8", timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return result.stdout;
  } catch (error) {
    if (acceptedCodes.includes(error.code)) {
      return error.stdout;
    }
    const limited = error.killed || error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
    throw new Error(
      limited
        ? "Git превысил лимит времени или размера ответа. Откройте этот diff в терминале."
        : `Git: ${error.stderr?.trim() || error.message}`,
      { cause: error },
    );
  }
}

export async function repoRoot(directory) {
  const output = await runGit(path.resolve(directory), [
    "rev-parse",
    "--show-toplevel",
  ]);
  return output.trim();
}

export function parseStatus(output) {
  const parts = output.split("\0");
  const changes = [];
  for (let index = 0; index < parts.length; index++) {
    const record = parts[index];
    if (!record) {
      continue;
    }
    const staged = record[0];
    const working = record[1];
    const isRenamed = /[RC]/.test(staged + working);
    changes.push({ path: record.slice(3), staged, working, oldPath: isRenamed ? parts[++index] : "" });
  }
  return changes;
}

async function readChanges(root) {
  return parseStatus(
    await runGit(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]),
  );
}

export async function history(root, skip = 0) {
  const head = await runGit(
    root,
    [
      "rev-parse",
      "--verify",
      "HEAD",
    ],
    [
      128,
    ],
  );
  if (!head.trim()) {
    return {
      commits: [],
      more: false,
    };
  }
  const text = await runGit(root, [
    "log",
    "-z",
    "--format=%H%x00%an%x00%aI%x00%s",
    `--max-count=${PAGE_SIZE + 1}`,
    `--skip=${skip}`,
  ]);
  const fields = text.split("\0");
  const commits = [];
  for (let index = 0; index + 3 < fields.length; index += 4) {
    commits.push({
      oid: fields[index],
      author: fields[index + 1],
      date: fields[index + 2],
      subject: fields[index + 3],
    });
  }
  return {
    commits: commits.slice(0, PAGE_SIZE),
    more: commits.length > PAGE_SIZE,
  };
}

export async function snapshot(root) {
  const branchText = await runGit(
    root,
    [
      "symbolic-ref",
      "--short",
      "-q",
      "HEAD",
    ],
    [
      1,
    ],
  );
  const headText = await runGit(
    root,
    [
      "rev-parse",
      "--verify",
      "HEAD",
    ],
    [
      128,
    ],
  );
  const branch = branchText.trim();
  const head = headText.trim();
  const [
    files,
    log,
  ] = await Promise.all([
    readChanges(root),
    history(root),
  ]);
  return {
    root,
    branch: branch || `detached HEAD · ${head.slice(0, 8)}`,
    changes: files,
    ...log,
  };
}

function validPath(value) {
  if (!value || value.includes("\0") || value.split(/[\\/]/).includes("..") || path.isAbsolute(value)) {
    throw new Error("Недопустимый путь файла.");
  }
  return value;
}

export async function diff(root, parameters) {
  const commit = parameters.get("commit");
  const flags = [
    "--no-ext-diff",
    "--no-textconv",
    "--submodule=short",
  ];
  if (commit) {
    if (!/^(?:[\da-f]{40}|[\da-f]{64})$/.test(commit)) {
      throw new Error("Недопустимый коммит.");
    }
    return {
      patch: await runGit(root, [
        "show",
        "--format=",
        "--first-parent",
        ...flags,
        commit,
      ]),
    };
  }
  const filepath = validPath(parameters.get("path"));
  const area = parameters.get("area");
  const files = await readChanges(root);
  const file = files.find((entry) => entry.path === filepath);
  if (!file) {
    throw new Error("Файл больше не входит в список изменений. Обновите Git.");
  }
  if (area === "untracked" && file.staged === "?") {
    const parent = await realpath(path.dirname(path.join(root, filepath)));
    const relative = path.relative(await realpath(root), parent);
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
      throw new Error("Путь находится за пределами репозитория.");
    }
    return {
      patch: await runGit(
        root,
        [
          "diff",
          "--no-index",
          ...flags,
          "--",
          devNull,
          filepath,
        ],
        [
          1,
        ],
      ),
    };
  }
  if (
    !new Set([
      "staged",
      "working",
    ]).has(area)
  ) {
    throw new Error("Недопустимый вид сравнения.");
  }
  const stage =
    area === "staged"
      ? [
          "--cached",
        ]
      : [];
  const paths = file.oldPath
    ? [
        file.oldPath,
        filepath,
      ]
    : [
        filepath,
      ];
  return {
    patch: await runGit(root, [
      "diff",
      ...stage,
      ...flags,
      "--",
      ...paths,
    ]),
  };
}

const SITE = "https://opennotes.github.io";

function allowedOrigin(origin) {
  try {
    const url = new URL(origin);
    return (
      origin === SITE ||
      (url.protocol === "http:" &&
        [
          "127.0.0.1",
          "localhost",
        ].includes(url.hostname) &&
        url.origin === origin)
    );
  } catch {
    return false;
  }
}

function authorized(value, token) {
  const supplied = Buffer.from(value || "");
  const expected = Buffer.from(`Bearer ${token}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function send(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

function route(root, url) {
  if (url.pathname === "/repository") {
    return snapshot(root);
  }
  if (url.pathname === "/diff") {
    return diff(root, url.searchParams);
  }
  if (url.pathname === "/history") {
    const skip = Number(url.searchParams.get("skip") || 0);
    if (!Number.isSafeInteger(skip) || skip < 0) {
      throw new Error("Недопустимая страница истории.");
    }
    return history(root, skip);
  }
  throw new Error("Неизвестный запрос Git.");
}

export async function startGitServer(directory, options = {}) {
  const root = await repoRoot(directory);
  const token = randomBytes(32).toString("hex");
  const requests = new Set();
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const address = server.address();
    if (request.headers.host !== `127.0.0.1:${address.port}` || !allowedOrigin(origin)) {
      send(response, 403, { error: "Этот адрес сайта не разрешён." });
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Authorization",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return;
    }
    if (request.method !== "GET" || !authorized(request.headers.authorization, token)) {
      send(response, 401, { error: "Нужна новая ссылка подключения из терминала." });
      return;
    }
    if (requests.size >= MAX_CONCURRENT_REQUESTS) {
      send(response, 429, { error: "Git занят. Повторите запрос после завершения текущего." });
      return;
    }
    requests.add(request);
    try {
      send(response, 200, await route(root, new URL(request.url, "http://127.0.0.1")));
    } catch (error) {
      send(response, 400, { error: error.message });
    } finally {
      requests.delete(request);
    }
  });
  server.requestTimeout = 20_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port || 0, "127.0.0.1", resolve);
  });
  const connection = `http://127.0.0.1:${server.address().port}/#${token}`;
  return {
    server,
    connection,
    root,
  };
}

async function main() {
  const { root, connection } = await startGitServer(process.argv[2] || process.cwd());
  console.log(
    `Git: ${root}\nТолько чтение. Для остановки: Ctrl+C.\n\nОткройте редактор:\n${SITE}/edit.html#git=${encodeURIComponent(connection)}\n\nАдрес для кнопки «Git» в уже открытом редакторе:\n${connection}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
