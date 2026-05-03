import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadEvents() {
    const handlers = [];
    const eventCommands = {};

    let files;
    try {
        files = (await readdir(__dirname)).filter(
            (f) => f.endsWith(".js") && f !== "index.js"
        );
    } catch {
        return { handlers, eventCommands };
    }

    let successCount = 0;

    for (const file of files) {
        try {
            const modulePath = pathToFileURL(join(__dirname, file)).href + "?t=" + Date.now();
            const mod = await import(modulePath);
            if (typeof mod.handle !== "function" && typeof mod.handleReaction !== "function" && typeof mod.handleGroupEvent !== "function" && typeof mod.handleUndo !== "function") continue;

            const evtName = mod.name ?? file.replace(".js", "");
            handlers.push({
                name: evtName,
                description: mod.description ?? "",
                alwaysRun: mod.alwaysRun || false,
                handle: mod.handle,
                handleGroupEvent: mod.handleGroupEvent,
                handleReaction: mod.handleReaction,
                handleUndo: mod.handleUndo
            });

            if (mod.commands && typeof mod.commands === "object") {
                for (const [cmd, handler] of Object.entries(mod.commands)) {
                    eventCommands[cmd] = handler;
                }
            }
            successCount++;
        } catch (e) {
            log.error(`Event ${file} lỗi`, e.message);
        }
    }

    if (successCount > 0) log.system(`Tải thành công ${successCount} handler sự kiện.`);
    return { handlers, eventCommands };
}
