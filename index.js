const express = require('express');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core');

const app = express();

app.use(cors());
app.use(express.json());

// Tải Proxy từ biến môi trường (Environment Variable) trên Render
const PROXY_URL = process.env.PROXY_URL || 'http://sndjdzty:3bdt86sfpjkc@31.59.20.176:6754';

// Tạo Agent cấu hình cho ytdl
function getAgent() {
    const options = {
        pipelining: 5,
        maxRedirections: 5
    };

    if (PROXY_URL) {
        // Hỗ trợ cấu hình proxy nếu có khai báo trong biến môi trường
        options.proxy = PROXY_URL;
    }

    return ytdl.createAgent(undefined, options);
}

/**
 * Endpoint 1: Lấy thông tin video & Direct Link Stream
 * GET /api/info?url=https://www.youtube.com/watch?v=...
 */
app.get('/api/info', async (req, res) => {
    try {
        const videoUrl = req.query.url;

        if (!videoUrl || !ytdl.validateURL(videoUrl)) {
            return res.status(400).json({ status: false, message: 'URL YouTube không hợp lệ' });
        }

        const agent = getAgent();

        // Lấy thông tin chi tiết video kèm Agent
        const info = await ytdl.getInfo(videoUrl, { agent });

        // Lọc lấy luồng tốt nhất có cả Âm thanh + Hình ảnh
        const combinedFormat = ytdl.chooseFormat(info.formats, { 
            quality: 'highestvideo', 
            filter: 'audioandvideo' 
        });
        
        // Lọc lấy luồng Audio riêng biệt chất lượng cao nhất
        const audioFormat = ytdl.chooseFormat(info.formats, { 
            quality: 'highestaudio',
            filter: 'audioonly' 
        });

        // Thiết lập Cache control để giảm tải request
        res.setHeader('Cache-Control', 'public, max-age=3600');

        return res.json({
            status: true,
            data: {
                title: info.videoDetails.title,
                duration: info.videoDetails.lengthSeconds,
                author: info.videoDetails.author.name,
                thumbnail: info.videoDetails.thumbnails.pop()?.url,
                stream_url: combinedFormat ? combinedFormat.url : null,
                audio_url: audioFormat ? audioFormat.url : null
            }
        });

    } catch (error) {
        console.error('Error in /api/info:', error.message);
        return res.status(500).json({ 
            status: false, 
            error: 'Không thể bóc tách dữ liệu YouTube: ' + error.message 
        });
    }
});

/**
 * Endpoint 2: Pipe trực tiếp luồng Âm thanh (Proxy Stream)
 * GET /api/stream-audio?url=https://www.youtube.com/watch?v=...
 */
app.get('/api/stream-audio', async (req, res) => {
    try {
        const videoUrl = req.query.url;

        if (!videoUrl || !ytdl.validateURL(videoUrl)) {
            return res.status(400).json({ status: false, message: 'URL YouTube không hợp lệ' });
        }

        const agent = getAgent();

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Accept-Ranges', 'bytes');

        // Khởi tạo stream audio với cấu hình agent
        const stream = ytdl(videoUrl, {
            filter: 'audioonly',
            quality: 'highestaudio',
            highWaterMark: 1 << 25,
            agent
        });

        // Xử lý lỗi trong quá trình streaming để tránh crash server
        stream.on('error', (err) => {
            console.error('Stream Error:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ status: false, error: 'Lỗi truyền tải luồng âm thanh.' });
            }
        });

        stream.pipe(res);

    } catch (error) {
        console.error('Error in /api/stream-audio:', error.message);
        if (!res.headersSent) {
            return res.status(500).json({ status: false, error: error.message });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;