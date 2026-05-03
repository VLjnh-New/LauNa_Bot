import axios from 'axios';
import zing from './zingmp3.js';

let SPOTIFY_TOKEN = "BQAFTKQ7F5duT2fMfJttQfEkh7GetOTqNwtmih8jmIva5z46hKLrLSeU6To7ctwr1wdVY_AF3aZ6v4qdhdPJrRiKR43cFWTorE4edEo5Oi1risDUa5zYurEIq4xdg53zdj2kKB4wUme2VPQKGKXnVmX_VNwd7516w_ry7qXnHqh7M5duZz-z2w77IAtVdi9X2hi463KIRn2ZuY6NmM2b5ZPAHB2GIw4AXXhAURFy1m5K8zJuBykGe5b4OV8NQs3077p3mu5dW-1B94ntslDbC5a33yxhmouDmx5NaPZ_sc2hlC-bMxGuwDYuVZlBRVjM3tgweGJ_NWEehpx-t0pM4Q1C3Ib2S0qmaoJuH95SSGiTysjni3OyOro3ykCtrEmv9_Khw4buCHezzgm7hw";
let CLIENT_TOKEN = "AAAI78Fcz1TQiPf+cSOQada/VI7ksCJ29zv4tCQ1PQ5Dr5MAVmjfPYl6dE+R5fVTPOS1XlVstFR7QsP5T4k9/yMgDnZ6Nj6aw9xRSkUuq9brdLeBFU0yuDhSgSGzb2QX/CKK+30/UukAAY9dgomiWO4F6h37XhCWi2y/OsVB7io4W/PjXviHBuBMwzipxiyrMofPHEx72/VvtAdtA8SydcCZB7KJ5Fg9rRPdqn9MIahFxDycfZLflDjCv+0UuijdqnIGGqNQL+HjsFvbwU/ODPoF3VSKTW+BbEppuDVkn+vLCdZXRvnK/KT6G041FvbRjg04XyOjMO44ZRLeYSfNsounOfs=";
let TOKEN_EXPIRY = Date.now() + 3600000;

function convert(ms) {
    const m = Math.floor(ms / 60000);
    const s = ((ms % 60000) / 1000).toFixed(0);
    return m + ":" + (s < 10 ? "0" : "") + s;
}

/**
 * Lấy Access Token mới từ Spotify (Guest Token)
 */
async function refreshToken() {
    if (SPOTIFY_TOKEN && Date.now() < TOKEN_EXPIRY) return;
    try {
        const res = await axios.get('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                'referer': 'https://open.spotify.com/',
                'origin': 'https://open.spotify.com'
            },
            timeout: 5000
        });
        if (res.data?.accessToken) {
            SPOTIFY_TOKEN = res.data.accessToken;
            TOKEN_EXPIRY = res.data.accessTokenExpirationTimestampMs || (Date.now() + 3000000);
            return true;
        }
    } catch (e) {
        // console.error("Lỗi làm mới Spotify Token:", e.message);
    }
    return false;
}

/**
 * Tìm kiếm bài hát 
 */
export async function search(query) {
    await refreshToken();
    // Try Spotify Search API
    try {
        const res = await axios({
            method: 'POST',
            url: 'https://api-partner.spotify.com/pathfinder/v2/query',
            headers: {
                'authorization': `Bearer ${SPOTIFY_TOKEN}`,
                'client-token': CLIENT_TOKEN,
                'app-platform': 'WebPlayer',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
                'content-type': 'application/json;charset=UTF-8',
                'origin': 'https://open.spotify.com',
                'referer': 'https://open.spotify.com/'
            },
            data: {
                "operationName": "searchTracks",
                "variables": { "searchTerm": query, "offset": 0, "limit": 10, "numberOfTopResults": 5, "includePreReleases": false, "includeAudiobooks": true },
                "extensions": { "persistedQuery": { "version": 1, "sha256Hash": "59ee4a659c32e9ad894a71308207594a65ba67bb6b632b183abe97303a51fa55" } }
            },
            timeout: 5000
        });

        const items = res.data?.data?.searchV2?.tracksV2?.items || [];
        if (items.length > 0) {
            return items.map(item => {
                const track = item.item.data;
                const album = track.albumOfTrack;
                const artistList = track.artists.items.map(a => a.profile.name).join(", ");
                const cover = album.coverArt.sources.find(s => s.width === 640)?.url || album.coverArt.sources[0]?.url;
                return { id: track.id, title: track.name, artist: artistList, album: album.name, duration: convert(track.duration.totalMilliseconds), thumbnail: cover, isSpotify: true };
            });
        }
    } catch (err) {
        // console.warn("Spotify Search API failed");
    }

    // Try SpotifyDown Search Mirror
    try {
        const res = await axios.get(`https://api.vreden.my.id/api/spotify-search?query=${encodeURIComponent(query)}`, { timeout: 10000 });
        if (res.data?.status === 200 && res.data.result.length > 0) {
            return res.data.result.map(item => ({
                id: item.url.split('track/')[1],
                title: item.title,
                artist: item.artists,
                duration: item.duration,
                thumbnail: item.thumbnail,
                isSpotify: true
            }));
        }
    } catch (e) { }

    // Backup iTunes Search
    try {
        const fallback = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=10&country=VN`);
        if (!fallback.data?.results) return [];
        return fallback.data.results.map(t => ({
            id: t.trackId.toString(),
            title: t.trackName, artist: t.artistName, album: t.collectionName || "",
            duration: convert(t.trackTimeMillis),
            thumbnail: t.artworkUrl100.replace("100x100bb", "600x600bb"),
            isSpotify: false
        }));
    } catch { return []; }
}

/**
 * TẢI NHẠC 
 */
export async function download(id, title = "", artist = "") {
    try {
        let trackId = id.toString();
        
        // Nếu ID là số (từ iTunes), ta cần tìm ID Spotify tương ứng
        if (/^\d+$/.test(trackId)) {
            const query = `${title} ${artist}`;
            const searchResults = await search(query);
            const found = searchResults.find(r => r.isSpotify);
            if (found) trackId = found.id;
            // Nếu không tìm thấy, thử dùng chính trackId cho vgasoft (nếu vgasoft hỗ trợ iTunes ID)
        }

        // Tải qua SpotifyDown (thường ổn định hơn)
        const spotifyDownData = await downloadFromSpotifyDown(trackId);
        if (spotifyDownData) return spotifyDownData;

        // Fallback VgaSoft
        const vgaData = await downloadFromVgaSoft(trackId);
        if (vgaData) return vgaData;

        // Fallback cuối cùng: Tìm và lấy nhạc từ ZingMP3 nếu Spotify tịt hết
        const zingData = await downloadFromZing(title, artist);
        if (zingData) return zingData;

        throw new Error("Không lấy được link tải bài hát này từ bất kỳ nguồn nào.");
    } catch (e) {
        throw new Error(e.message || "Lỗi không xác định khi tải");
    }
}

async function downloadFromVgaSoft(spId) {
    try {
        const spotifyLink = `https://open.spotify.com/track/${spId}`;
        const vgaApi = `https://download.vgasoft.vn/web/c/spotify/getVideo?link=${encodeURIComponent(spotifyLink)}`;
        const headers = { 'User-Agent': 'Mozilla/5.0', 'OS': 'webSite', 'Referer': 'https://downloadvideo.vn/', 'Origin': 'https://downloadvideo.vn' };
        const res = await axios.get(vgaApi, { headers, timeout: 15000 });
        const result = res.data?.result;
        if (!result) return null;
        const mp3Url = result.music?.[0]?.url || result.music?.[0]?.link;
        if (mp3Url) return { id: spId, primaryUrl: mp3Url, title: result.title || "Spotify Track", thumbnail: result.thumbnail };
    } catch { return null; }
}

async function downloadFromSpotifyDown(spId) {
    try {
        const res = await axios.get(`https://api.spotifydown.com/download/${spId}`, {
            headers: { 'Origin': 'https://spotifydown.com', 'Referer': 'https://spotifydown.com/', 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000
        });
        if (res.data?.success && res.data.link) {
            return { id: spId, primaryUrl: res.data.link, title: res.data.metadata?.title, artist: res.data.metadata?.artists, thumbnail: res.data.metadata?.cover };
        }
    } catch { return null; }
    return null;
}

async function downloadFromZing(title, artist) {
    try {
        const query = `${title} ${artist}`.trim();
        const results = await zing.searchZing(query);
        if (results.length > 0) {
            const first = results[0];
            const stream = await zing.getStreamZing(first.encodeId);
            const url = stream?.["128"] || stream?.["320"];
            if (url) {
                return {
                    id: first.encodeId,
                    primaryUrl: url,
                    title: first.title,
                    artist: first.artistsNames,
                    thumbnail: first.thumbnail
                };
            }
        }
    } catch { return null; }
    return null;
}

/**
 * LẤY LYRICS 
 */
export async function getLyrics(trackId, coverUrl, title = "", artist = "") {
    await refreshToken();
    try {
        let spId = trackId.toString();
        if (/^\d+$/.test(spId)) {
            const query = `${title} ${artist}`;
            const searchResults = await search(query);
            const found = searchResults.find(r => r.isSpotify);
            if (found) spId = found.id;
            else return null;
        }

        const url = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${spId}/image/${encodeURIComponent(coverUrl)}?format=json&vocalRemoval=false&market=from_token`;
        const res = await axios.get(url, {
            headers: { 'authorization': `Bearer ${SPOTIFY_TOKEN}`, 'client-token': CLIENT_TOKEN, 'app-platform': 'WebPlayer', 'user-agent': 'Mozilla/5.0' },
            timeout: 8000
        });
        if (res.data?.lyrics?.lines) return res.data.lyrics.lines.map(line => line.words).filter(w => w && w.trim() !== "").join('\n');
    } catch (e) { }
    return null;
}

export default { search, download, getLyrics };
