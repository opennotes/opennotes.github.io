export function fileHandle(name, content = "", type = "") {
  let modified = 1;
  let value = content;
  const handle = {
    kind: "file",
    name,
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    async getFile() {
      return new File([value], name, { type, lastModified: modified });
    },
    async createWritable() {
      let next;
      return {
        async write(text) {
          next = text;
        },
        async close() {
          value = next;
          modified++;
        },
        async abort() {},
      };
    },
    change(text) {
      value = text;
      modified++;
    },
  };
  return handle;
}
export function directory(name, entries = []) {
  const children = new Map(entries.map((entry) => [entry.name, entry]));
  const folder = {
    kind: "directory",
    name,
    children,
    requestPermission: async () => "granted",
    queryPermission: async () => "granted",
    async *values() {
      yield* children.values();
    },
    async getFileHandle(nameValue, options = {}) {
      let entry = children.get(nameValue);
      if (!entry && options.create) {
        entry = fileHandle(nameValue);
        children.set(nameValue, entry);
      }
      if (!entry) {
        throw new DOMException("Missing", "NotFoundError");
      }
      if (entry.kind !== "file") {
        throw new DOMException("Directory", "TypeMismatchError");
      }
      return entry;
    },
    async getDirectoryHandle(nameValue, options = {}) {
      let entry = children.get(nameValue);
      if (!entry && options.create) {
        entry = directory(nameValue);
        children.set(nameValue, entry);
      }
      if (!entry) {
        throw new DOMException("Missing", "NotFoundError");
      }
      if (entry.kind !== "directory") {
        throw new DOMException("File", "TypeMismatchError");
      }
      return entry;
    },
    async removeEntry(nameValue) {
      children.delete(nameValue);
    },
  };
  return folder;
}
