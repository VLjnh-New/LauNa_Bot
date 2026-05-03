// ─── Managers ────────────────────────────────────────────────────────────────
import { rentalManager } from "../managers/rentalManager.js";
import { autoReactManager } from "../managers/autoReactManager.js";
import { protectionManager } from "../managers/protectionManager.js";
import { prefixManager } from "../managers/prefixManager.js";
import { cooldownManager } from "../managers/cooldownManager.js";
import { statsManager } from "../managers/statsManager.js";
import { messageCache } from "../core/messageCache.js";
import { threadSettingsManager } from "../managers/threadSettingsManager.js";
import { bankManager } from "../managers/bankManager.js";
import { keyManager } from "../managers/keyManager.js";
import { groupAdminManager } from "../managers/groupAdminManager.js";
import { proxyPool } from "../managers/proxyPool.js";

global.rentalManager = rentalManager;
global.autoReactManager = autoReactManager;
global.protectionManager = protectionManager;
global.prefixManager = prefixManager;
global.cooldownManager = cooldownManager;
global.statsManager = statsManager;
global.messageCache = messageCache;
global.threadSettingsManager = threadSettingsManager;
global.bankManager = bankManager;
global.keyManager = keyManager;
global.groupAdminManager = groupAdminManager;
global.proxyPool = proxyPool;

// ─── IO / JSON ────────────────────────────────────────────────────────────────
import {
    tempDir,
    logMessageToFile,
    readJSON,
    writeJSON,
    cleanTempFiles,
    cleanupOldFiles,
} from "../core/io-json.js";

global.tempDir = tempDir;
global.logMessageToFile = logMessageToFile;
global.readJSON = readJSON;
global.writeJSON = writeJSON;
global.cleanTempFiles = cleanTempFiles;
global.cleanupOldFiles = cleanupOldFiles;

// ─── Tiện ích chung (util.js) ─────────────────────────────────────────────────
import {
    uploadTempFile,
    uploadToCatbox,
    downloadFile,
    deleteFile,
    getImageInfo,
    checkExstentionFileRemote,
    fetchTikTokUserVideos,
    fetchVideosByYtDlp,
    resolveTikTokUser,
} from "../core/util.js";

global.uploadTempFile = uploadTempFile;
global.uploadToCatbox = uploadToCatbox;
global.downloadFile = downloadFile;
global.deleteFile = deleteFile;
global.getImageInfo = getImageInfo;
global.checkExstentionFileRemote = checkExstentionFileRemote;
global.fetchTikTokUserVideos = fetchTikTokUserVideos;
global.fetchVideosByYtDlp = fetchVideosByYtDlp;
global.resolveTikTokUser = resolveTikTokUser;

// ─── Downloaders ──────────────────────────────────────────────────────────────
import { downloadTikTok } from "../downloaders/tiktokDownloader.js";
import { downloadYoutube } from "../music/youtube.js";
import { downloadCapCutV1, downloadCapCutV2, downloadCapCutV3, searchCapCut } from "../downloaders/capcutDownloader.js";
import { downloadDouyin } from "../downloaders/douyinDownloader.js";
import { downloadInstagram, getInstagramProfile } from "../downloaders/instagram.js";
import { downloadMixcloud, searchMixcloud } from "../downloaders/mixcloudDownloader.js";
import { fetchThreadsMedia, downloadThreadsFile } from "../downloaders/threadsDownloader.js";
import { uploadFromUrl, uploadFromFile } from "../core/cloudinary.js";
import { uploadToTmpFiles } from "../core/tmpFiles.js";

global.downloadTikTok = downloadTikTok;
global.downloadYoutube = downloadYoutube;
// global.downloadYoutubeMp3 = downloadYoutubeMp3;
// global.downloadYoutubeVideo = downloadYoutubeVideo;
global.downloadCapCutV1 = downloadCapCutV1;
global.downloadCapCutV2 = downloadCapCutV2;
global.downloadCapCutV3 = downloadCapCutV3;
global.searchCapCut = searchCapCut;
global.downloadDouyin = downloadDouyin;
global.downloadInstagram = downloadInstagram;
global.getInstagramProfile = getInstagramProfile;
global.downloadMixcloud = downloadMixcloud;
global.searchMixcloud = searchMixcloud;
global.fetchThreadsMedia = fetchThreadsMedia;
global.downloadThreadsFile = downloadThreadsFile;
global.uploadFromUrl = uploadFromUrl;
global.uploadFromFile = uploadFromFile;
global.uploadToTmpFiles = uploadToTmpFiles;

// ─── Âm nhạc ─────────────────────────────────────────────────────────────────
import soundcloud from "../music/soundcloud.js";
import spotify from "../music/spotify.js";
import {
    searchZing,
    getStreamZing,
    getRecommendZing,
    getDetailPlaylist,
    getZingChart,
} from "../music/zingmp3.js";
import { searchNCT, getSongInfoV1, getSimilarSongs } from "../music/nhaccuatui.js";

global.soundcloud = soundcloud;
global.spotify = spotify;
global.searchZing = searchZing;
global.getStreamZing = getStreamZing;
global.getRecommendZing = getRecommendZing;
global.getDetailPlaylist = getDetailPlaylist;
global.getZingChart = getZingChart;
global.searchNCT = searchNCT;
global.getSongInfoV1 = getSongInfoV1;
global.getSimilarSongs = getSimilarSongs;

// ─── Canvas / Vẽ ảnh ─────────────────────────────────────────────────────────
import {
    drawSoundCloudSearch,
    drawZingSearch,
    drawZingPlayer,
    drawZingPlaylist,
    drawWeatherCard,
    drawUserInfo,
    drawMcSearch,
    drawMcPlayer,
    drawTikTokSearch,
    drawWelcome,
    drawGoodbye,
    drawTaiXiu,
    drawCapCutSearch,
    drawGroupCard,
    drawNoitu,
    drawVtv,
    drawUptimeCard,
    drawMailCard,
} from "../canvas/canvasHelper.js";

global.drawSoundCloudSearch = drawSoundCloudSearch;
global.drawZingSearch = drawZingSearch;
global.drawZingPlayer = drawZingPlayer;
global.drawZingPlaylist = drawZingPlaylist;
global.drawWeatherCard = drawWeatherCard;
global.drawUserInfo = drawUserInfo;
global.drawMcSearch = drawMcSearch;
global.drawMcPlayer = drawMcPlayer;
global.drawTikTokSearch = drawTikTokSearch;
global.drawWelcome = drawWelcome;
global.drawGoodbye = drawGoodbye;
global.drawTaiXiu = drawTaiXiu;
global.drawCapCutSearch = drawCapCutSearch;
global.drawGroupCard = drawGroupCard;
global.drawNoitu = drawNoitu;
global.drawVtv = drawVtv;
global.drawUptimeCard = drawUptimeCard;
global.drawMailCard = drawMailCard;

// ─── Danh sách reaction ───────────────────────────────────────────────────────
import { reaction_all } from "../core/reactionList.js";

global.reaction_all = reaction_all;

// ─── Xóa nền ảnh (removebg) ───────────────────────────────────────────────────
import { removeBackground, scanWebProviders } from "../core/removebg.js";

global.removeBackground = removeBackground;
global.scanWebProviders = scanWebProviders;

// ─── Duck.ai core ─────────────────────────────────────────────────────────────
import {
    askDuckAI,
    askDuckAIAuto,
    askDuckAIVision,
    duckGenerateImage,
    sendDuckImage,
    duckChat,
    getDuckHistory,
    clearDuckHistory,
} from "../../modules/duckai.js";

global.askDuckAI        = askDuckAI;        // askDuckAI(prompt, model?)
global.askDuckAIAuto    = askDuckAIAuto;    // askDuckAIAuto(threadId, msg, model?) — có lịch sử
global.askDuckAIVision  = askDuckAIVision;  // askDuckAIVision(base64, mime, prompt, model?)
global.duckGenerateImage = duckGenerateImage; // duckGenerateImage(prompt) → { imageUrls, textMsg }
global.sendDuckImage    = sendDuckImage;    // sendDuckImage(api, src, caption, threadId, threadType)
global.duckChat         = duckChat;         // duckChat(messages, model, mode?) — mode: "proxy"|"direct"|"croxy"
global.getDuckHistory   = getDuckHistory;   // getDuckHistory(threadId)
global.clearDuckHistory = clearDuckHistory; // clearDuckHistory(threadId)
