const express = require('express');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core');

const app = express();

app.use(cors());
app.use(express.json());

/**
 * Endpoint 1: Lấy thông tin video & Direct Link Stream (Khuyên dùng cho Web/Player)
 * GET /api/info?url=https://www.youtube.com/watch?v=...
 */
app.get('/api/info', async (req, res) => {
    try {
        const videoUrl = req.query.url;

        if (!videoUrl || !ytdl.validateURL(videoUrl)) {
            return res.status(400).json({ status: false, message: 'URL YouTube không hợp lệ' });
        }

        // Lấy thông tin chi tiết video
        const info = await ytdl.getInfo(videoUrl);

        // Lọc lấy luồng tốt nhất có cả Âm thanh + Hình ảnh (thường ở 360p/720p)
        const combinedFormat = ytdl.chooseFormat(info.formats, { quality: 'highestvideo', filter: 'audioandvideo' });
        
        // Lọc lấy luồng Audio riêng biệt chất lượng cao nhất (cho trình nghe nhạc)
        const audioFormat = ytdl.chooseFormat(info.formats, { filter: 'audioonly' });

        return res.json({
            status: true,
            data: {
                title: info.videoDetails.title,
                duration: info.videoDetails.lengthSeconds,
                author: info.videoDetails.author.name,
                thumbnail: info.videoDetails.thumbnails.pop()?.url,
                // Trực tiếp Link Google Video Stream để gán vào trình phát HTML5 / VideoJS
                stream_url: combinedFormat ? combinedFormat.url : null,
                audio_url: audioFormat ? audioFormat.url : null
            }
        });

    } catch (error) {
        return res.status(500).json({ status: false, error: error.message });
    }
});

/**
 * Endpoint 2: Pipe trực tiếp luồng Âm thanh (Proxy Stream qua Vercel)
 * GET /api/stream-audio?url=https://www.youtube.com/watch?v=...
 */
app.get('/api/stream-audio', async (req, res) => {
    try {
        const videoUrl = req.query.url;

        if (!videoUrl || !ytdl.validateURL(videoUrl)) {
            return res.status(400).json({ status: false, message: 'URL YouTube không hợp lệ' });
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Accept-Ranges', 'bytes');

        // Pipe trực tiếp luồng audio
        ytdl(videoUrl, {
            filter: 'audioonly',
            highWaterMark: 1 << 25
        }).pipe(res);

    } catch (error) {
        return res.status(500).json({ status: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;