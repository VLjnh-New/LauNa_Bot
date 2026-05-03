import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadModules() {
    const allCommands = {};
    const moduleInfo = [];
    const extraHandlers = [];

    let files;
    try {
        files = (await readdir(__dirname)).filter(
            (f) => f.endsWith(".js") && f !== "index.js"
        );
    } catch {
        return { allCommands, moduleInfo, extraHandlers };
    }

    let successCount = 0;
    let errorCount = 0;

    for (const file of files) {
        try {
            const modulePath = pathToFileURL(join(__dirname, file)).href + "?t=" + Date.now();
            const mod = await import(modulePath);

            const modName = mod.name ?? file.replace(".js", "");
            const modDesc = mod.description ?? "";

            if (mod.commands && typeof mod.commands === "object") {
                const cmdEntries = [];

                if (Array.isArray(mod.commands)) {
                    for (const item of mod.commands) {
                        if (!item || typeof item.execute !== "function") continue;
                        const names = [item.name, ...(item.aliases || [])].filter(Boolean);
                        for (const n of names) {
                            cmdEntries.push([n, item.execute.bind(item)]);
                        }
                    }
                } else {
                    for (const [cmd, handler] of Object.entries(mod.commands)) {
                        cmdEntries.push([cmd, handler]);
                    }
                }

                for (const [cmd, handler] of cmdEntries) {
                    if (allCommands[cmd]) {
                        log.warn(`Module "${modName}" trùng lệnh: !${cmd}`);
                    }
                    allCommands[cmd] = handler;
                }
                const cmdNames = cmdEntries.map(([k]) => k);
                moduleInfo.push({ name: modName, description: modDesc, cmdCount: cmdNames.length, commands: cmdNames });
            }

            if (typeof mod.handle === "function" || typeof mod.handleReaction === "function" || typeof mod.handleGroupEvent === "function" || typeof mod.handleUndo === "function") {
                extraHandlers.push({
                    name: modName + "_handler",
                    alwaysRun: mod.alwaysRun || false,
                    handle: mod.handle,
                    handleReaction: mod.handleReaction,
                    handleGroupEvent: mod.handleGroupEvent,
                    handleUndo: mod.handleUndo
                });
            }
            successCount++;

        } catch (e) {
            errorCount++;
            log.error(`Module ${file} lỗi`, e.message);
        }
    }

    if (successCount > 0) log.system(`Tải thành công ${successCount} module hoạt động.`);
    return { allCommands, moduleInfo, extraHandlers };
}
