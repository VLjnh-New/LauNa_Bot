let botId = null;

export function setBotId(id) {
    botId = id;
}

export function getBotId() {
    return botId;
}

let prophylacticUpload = false;

export function getProphylacticUploadAttachment() {
    return prophylacticUpload;
}

export function setProphylacticUploadAttachment(value) {
    prophylacticUpload = value;
}

export function checkConfigUploadAttachment(ext) {
    // Just a placeholder for now
    return true;
}
