import { z } from "zod";
import { createExtStoreStorage, EXT_STORE_MAX_BYTES } from "../services/storage/ext-store.storage.js";
const jsonRecordSchema = z.record(z.unknown());
const payloadSchema = z.object({ data: jsonRecordSchema });
const namespaceSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
export async function extStoreRoutes(app) {
    const storage = createExtStoreStorage();
    app.get("/health", async () => {
        await storage.ensureReady();
        return { ok: true, schemaVersion: 1, storage: "data-dir" };
    });
    app.get("/", async () => ({ namespaces: await storage.list() }));
    app.get("/:namespace", async (req) => {
        const namespace = namespaceSchema.parse(req.params.namespace);
        const doc = await storage.get(namespace);
        return doc ? { exists: true, ...doc } : { exists: false, schemaVersion: 1, namespace, data: null };
    });
    app.put("/:namespace", { bodyLimit: EXT_STORE_MAX_BYTES }, async (req) => {
        const namespace = namespaceSchema.parse(req.params.namespace);
        const input = payloadSchema.parse(req.body);
        return storage.set(namespace, input.data);
    });
    app.delete("/:namespace", async (req, reply) => {
        const namespace = namespaceSchema.parse(req.params.namespace);
        await storage.delete(namespace);
        return reply.status(204).send();
    });
}
//# sourceMappingURL=ext-store.routes.js.map