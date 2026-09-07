import { z } from "zod";
import { createQrPanelStorage, QR_PANEL_RESULT_MAX_BYTES, QR_PANEL_STATE_MAX_BYTES, } from "../services/storage/qr-panel.storage.js";
const jsonRecordSchema = z.record(z.unknown());
const payloadSchema = z.object({ data: jsonRecordSchema });
const chatIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export async function qrPanelRoutes(app) {
    const storage = createQrPanelStorage();
    app.get("/health", async () => {
        await storage.ensureReady();
        return { ok: true, schemaVersion: 1, storage: "data-dir" };
    });
    app.get("/state", async () => {
        const state = await storage.getState();
        return state ? { exists: true, ...state } : { exists: false, schemaVersion: 1, data: null };
    });
    app.put("/state", { bodyLimit: QR_PANEL_STATE_MAX_BYTES }, async (req) => {
        const input = payloadSchema.parse(req.body);
        return storage.setState(input.data);
    });
    app.get("/results", async () => ({ chats: await storage.listResultChats() }));
    app.get("/results/:chatId", async (req) => {
        const chatId = chatIdSchema.parse(req.params.chatId);
        const results = await storage.getResults(chatId);
        return results ? { exists: true, ...results } : { exists: false, schemaVersion: 1, chatId, data: null };
    });
    app.put("/results/:chatId", { bodyLimit: QR_PANEL_RESULT_MAX_BYTES }, async (req) => {
        const chatId = chatIdSchema.parse(req.params.chatId);
        const input = payloadSchema.parse(req.body);
        return storage.setResults(chatId, input.data);
    });
    app.delete("/results/:chatId", async (req, reply) => {
        const chatId = chatIdSchema.parse(req.params.chatId);
        await storage.deleteResults(chatId);
        return reply.status(204).send();
    });
    app.delete("/all", async (_req, reply) => {
        await storage.clear();
        return reply.status(204).send();
    });
}
//# sourceMappingURL=qr-panel.routes.js.map