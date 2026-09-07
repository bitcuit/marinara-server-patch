// ──────────────────────────────────────────────
// Storage: Extension Store (shared key-value store for personal extensions)
// ──────────────────────────────────────────────
//
// Small per-extension JSON documents that would otherwise live only in the
// browser's localStorage (User Status design library, GM Journal directive and
// defaults, ...). One file per namespace under DATA_DIR/ext-store/<ns>.json.
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DATA_DIR } from "../../utils/data-dir.js";
import { assertInsideDir } from "../../utils/security.js";
const EXT_STORE_ROOT = assertInsideDir(DATA_DIR, join(DATA_DIR, "ext-store"));
const SCHEMA_VERSION = 1;
const NAMESPACE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const EXT_STORE_MAX_BYTES = 32 * 1024 * 1024;
const writeQueues = new Map();
function isJsonRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
export function validateNamespace(namespace) {
    if (!NAMESPACE_RE.test(namespace))
        throw new Error("Invalid extension store namespace");
    return namespace;
}
function docPath(namespace) {
    return assertInsideDir(EXT_STORE_ROOT, join(EXT_STORE_ROOT, `${validateNamespace(namespace)}.json`));
}
function serializeWithinLimit(value, maxBytes) {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
        throw new Error(`Extension store payload exceeds ${Math.floor(maxBytes / 1024 / 1024)} MB`);
    }
    return `${serialized}\n`;
}
async function withWriteQueue(path, operation) {
    const previous = writeQueues.get(path) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(operation);
    const marker = queued.then(() => undefined, () => undefined);
    writeQueues.set(path, marker);
    try {
        return await queued;
    }
    finally {
        if (writeQueues.get(path) === marker)
            writeQueues.delete(path);
    }
}
async function atomicWriteJson(path, value, maxBytes) {
    const content = serializeWithinLimit(value, maxBytes);
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = assertInsideDir(EXT_STORE_ROOT, `${path}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    try {
        await rename(temporaryPath, path);
    }
    catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
async function readJsonRecord(path) {
    if (!existsSync(path))
        return null;
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (!isJsonRecord(parsed))
        throw new Error("Extension store file is not a JSON object");
    return parsed;
}
export function createExtStoreStorage() {
    return {
        rootDir: EXT_STORE_ROOT,
        async ensureReady() {
            await mkdir(EXT_STORE_ROOT, { recursive: true });
            return EXT_STORE_ROOT;
        },
        async list() {
            await mkdir(EXT_STORE_ROOT, { recursive: true });
            const entries = await readdir(EXT_STORE_ROOT, { withFileTypes: true });
            const rows = await Promise.all(entries
                .filter((entry) => entry.isFile() && /^[a-z0-9][a-z0-9_-]{0,63}\.json$/.test(entry.name))
                .map(async (entry) => {
                const path = assertInsideDir(EXT_STORE_ROOT, join(EXT_STORE_ROOT, entry.name));
                const info = await stat(path);
                const envelope = await readJsonRecord(path).catch(() => null);
                return {
                    namespace: entry.name.slice(0, -5),
                    updatedAt: envelope?.updatedAt ?? info.mtime.toISOString(),
                    bytes: info.size,
                };
            }));
            return rows.sort((left, right) => left.namespace.localeCompare(right.namespace));
        },
        async get(namespace) {
            return readJsonRecord(docPath(namespace));
        },
        async set(namespace, data) {
            if (!isJsonRecord(data))
                throw new Error("Extension store data must be a JSON object");
            const safeNamespace = validateNamespace(namespace);
            const path = docPath(safeNamespace);
            const envelope = {
                schemaVersion: SCHEMA_VERSION,
                updatedAt: new Date().toISOString(),
                namespace: safeNamespace,
                data,
            };
            await withWriteQueue(path, () => atomicWriteJson(path, envelope, EXT_STORE_MAX_BYTES));
            return envelope;
        },
        async delete(namespace) {
            const path = docPath(namespace);
            await withWriteQueue(path, () => rm(path, { force: true }));
        },
    };
}
//# sourceMappingURL=ext-store.storage.js.map