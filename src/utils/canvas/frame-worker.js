import { parentPort, workerData, isMainThread } from 'worker_threads';
import path from 'path';
import fs from 'fs';

// 🛡️ Guard Clause: Chỉ chạy nếu là Worker, không chạy khi bót khởi động bình thường
if (!isMainThread && workerData) {
    processFrames().catch(err => {
        console.error('Worker Error:', err);
        process.exit(1);
    });
}

async function processFrames() {
    const { startFrame, endFrame, size, totalFrames, framesDir, imageBuffer, circleMask } = workerData;

    let Canvas, loadImage;
    try {
        const m = await import('skia-canvas');
        Canvas = m.Canvas;
        loadImage = m.loadImage;
    } catch (e) {
        parentPort.postMessage({ error: 'skia-canvas not available: ' + e.message });
        return;
    }

    const img = await loadImage(Buffer.from(imageBuffer));
    const mask = await loadImage(Buffer.isBuffer(circleMask) ? circleMask : Buffer.from(circleMask));

    for (let i = startFrame; i < endFrame; i++) {
        const frameName = `frame_${String(i).padStart(3, '0')}.png`;
        const framePath = path.join(framesDir, frameName);

        const canvas = new Canvas(size, size);
        const ctx = canvas.getContext('2d');

        ctx.drawImage(img, 0, 0, size, size);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(mask, 0, 0, size, size);

        const buf = await canvas.toBuffer('png');
        fs.writeFileSync(framePath, buf);
    }

    parentPort.postMessage('done');
}
