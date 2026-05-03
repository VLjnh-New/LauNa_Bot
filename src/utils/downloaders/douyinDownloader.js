import axios from "axios";

// ── TikWM fallback: hỗ trợ Douyin (dùng chung API với TikTok) ────────────────
async function _tikwmFallback(url) {
    const { data: res } = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, { timeout: 15000 });
    if (res.code !== 0 || !res.data) throw new Error(`TikWM: ${res.msg || 'không có data'}`);
    const d = res.data;
    return {
        title: d.title || '',
        author: d.author?.nickname || 'Douyin User',
        videoUrl: d.play || d.wmplay || null,
        audioUrl: d.music || null,
        images: d.images || [],
        cover: d.cover || d.origin_cover || null
    };
}

/**
 * Download Douyin video/images — savetik.io với fallback TikWM
 */
export async function downloadDouyin(url) {
    // ── Primary: savetik.io ───────────────────────────────────────────────────
    try {
        const params = new URLSearchParams();
        params.append('q', url);
        params.append('cursor', '0');
        params.append('page', '0');
        params.append('lang', 'vi');

        const { data: resData } = await axios.post('https://savetik.io/api/ajaxSearch', params.toString(), {
            timeout: 15000,
            headers: {
                'accept': '*/*',
                'accept-language': 'en-US,en;q=0.9,vi;q=0.8',
                'cache-control': 'no-cache',
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'origin': 'https://savetik.io',
                'referer': 'https://savetik.io/vi/douyin-video-downloader',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
            }
        });

        if (!resData || resData.status !== "ok" || !resData.data) throw new Error("SaveTik: status không ok");

        const htmlData = resData.data;
        const result = {
            title: '',
            author: 'Douyin User',
            videoUrl: null,
            audioUrl: null,
            images: [],
            cover: null
        };

        const titleMatch = htmlData.match(/<h3>([\s\S]*?)<\/h3>/);
        if (titleMatch) result.title = titleMatch[1].replace(/#\S+/g, '').replace(/<[^>]+>/g, '').trim();

        const coverMatch = htmlData.match(/<div class="image-tik">[\s\S]*?<img src="([^"]+)"/);
        if (coverMatch) result.cover = coverMatch[1].replace(/&amp;/g, '&');

        const imageDataMatch = htmlData.match(/data-imageData="([^"]+)"/);
        if (imageDataMatch) {
            try {
                const decoded = Buffer.from(imageDataMatch[1], 'base64').toString('utf-8');
                result.images = decoded.split(';').filter(u => u.startsWith('http')).map(u => u.replace(/&amp;/g, '&'));
            } catch {}
        }

        const aTags = [...htmlData.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
        for (const match of aTags) {
            const href = match[1].replace(/&amp;/g, '&');
            const text = match[2].toLowerCase();
            if ((text.includes("mp3") || text.includes("âm thanh")) && !result.audioUrl && href.startsWith("http")) {
                result.audioUrl = href;
            } else if ((text.includes("video") || text.includes("mp4")) && !text.includes("render") && !text.includes("other") && !text.includes("khác")) {
                if (!result.videoUrl && href.startsWith("http") && !href.includes("#")) result.videoUrl = href;
                if ((text.includes("hd") || text.includes("không logo")) && href.startsWith("http") && !href.includes("#")) result.videoUrl = href;
            }
        }

        const audioUrlMatch = htmlData.match(/data-audioUrl="([^"]+)"/);
        if (audioUrlMatch) {
            const auUrl = audioUrlMatch[1].replace(/&amp;/g, '&');
            if (auUrl.startsWith('http')) result.audioUrl = auUrl;
        }

        if (!result.videoUrl && result.images.length === 0) throw new Error("SaveTik: không tìm thấy media");
        return result;

    } catch (primaryErr) {
        // ── Fallback: TikWM ───────────────────────────────────────────────────
        try {
            return await _tikwmFallback(url);
        } catch (tikwmErr) {
            console.error(`[Douyin] Cả hai thất bại — SaveTik: ${primaryErr.message} | TikWM: ${tikwmErr.message}`);
            return null;
        }
    }
}
