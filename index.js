const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Đường dẫn file yt-dlp binary
const ytDlpPath = path.join(__dirname, 'yt-dlp');

// Proxy URL từ Environment Variable trên Render (hoặc fallback mặc định)
const PROXY_URL = process.env.PROXY_URL || "http://sndjdzty:3bdt86sfpjkc@31.59.20.176:6754";

/**
 * Hàm hỗ trợ gọi yt-dlp lấy thông tin JSON (Trả về Promise)
 */
function getMetadata(videoUrl, useProxy = true) {
    return new Promise((resolve, reject) => {
        let commandArgs = [
            `"${ytDlpPath}"`,
            `"${videoUrl}"`,
            '-f "ba[ext=m4a]/ba/bestaudio/b"', // Ép chọn Audio Stream
            '--no-playlist',
            '--skip-download',
            '--no-write-thumbnail',            // Bỏ qua lấy thumbnail chi tiết (tăng tốc)
            '--dump-single-json',
            '--no-warnings',
            '--no-check-certificates',
            '--extractor-args "youtube:player_client=android,ios,mweb"'
        ];

        if (useProxy && PROXY_URL && PROXY_URL.startsWith("http")) {
            commandArgs.push(`--proxy "${PROXY_URL}"`);
        }

        const command = commandArgs.join(' ');

        exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                return reject(stderr || error.message);
            }
            try {
                const output = JSON.parse(stdout);
                resolve(output);
            } catch (e) {
                reject('Lỗi parse dữ liệu JSON từ YouTube.');
            }
        });
    });
}

/**
 * Endpoint 1: Lấy thông tin video & Direct Link Stream (JSON response)
 * GET /api/info?url=https://www.youtube.com/watch?v=...
 * GET /api/audio-stream?url=https://www.youtube.com/watch?v=... (Giữ tương thích ngược)
 */
const handleInfoRequest = async (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    try {
        let output;
        try {
            // Lần 1: Thử gọi qua Proxy Webshare
            output = await getMetadata(videoUrl, true);
        } catch (proxyError) {
            console.warn("Proxy gặp sự cố, đang tự động thử lại không dùng Proxy...", proxyError);
            // Lần 2: Fallback thử gọi trực tiếp
            output = await getMetadata(videoUrl, false);
        }

        // Lấy link audio stream trực tiếp
        let audioUrl = output.url;

        if (!audioUrl && output.formats && output.formats.length > 0) {
            const pureAudio = output.formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.url);
            if (pureAudio.length > 0) {
                audioUrl = pureAudio[pureAudio.length - 1].url;
            } else {
                audioUrl = output.formats[0].url;
            }
        }

        if (!audioUrl) {
            return res.status(404).json({ status: false, message: 'Không tìm thấy đường dẫn Stream Audio phù hợp.' });
        }

        // Tối ưu Cache Header 2 tiếng cho browser
        res.setHeader('Cache-Control', 'public, max-age=7200');

        return res.json({
            status: true,
            data: {
                title: output.title,
                duration: output.duration,          // Thời lượng (giây)
                author: output.uploader || 'N/A',   // Tên ca sĩ / Kênh
                thumbnail: output.thumbnail,        // Ảnh đại diện bài hát
                audio_url: audioUrl,                // Link direct stream phát nhạc
                ext: output.ext || 'm4a'            // Định dạng file (m4a, webm)
            }
        });

    } catch (finalError) {
        console.error("Final yt-dlp Error:", finalError);
        return res.status(500).json({ 
            status: false, 
            error: 'Không thể trích xuất Audio từ YouTube. Hãy kiểm tra lại Proxy hoặc URL.' 
        });
    }
};

app.get('/api/info', handleInfoRequest);
app.get('/api/audio-stream', handleInfoRequest); // Alias cho tương thích cũ

/**
 * Endpoint 2: Pipe trực tiếp luồng Audio qua Server Render (Proxy Audio Stream)
 * GET /api/stream-audio?url=https://www.youtube.com/watch?v=...
 */
app.get('/api/stream-audio', (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    let args = [
        videoUrl,
        '-f', 'ba[ext=m4a]/ba/bestaudio',
        '-o', '-',
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        '--extractor-args', 'youtube:player_client=android,ios,mweb'
    ];

    if (PROXY_URL && PROXY_URL.startsWith("http")) {
        args.push('--proxy', PROXY_URL);
    }

    // Đổi thành audio/mp4 hoặc audio/aac để khớp chuẩn định dạng m4a của YouTube
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');

    const ytProcess = spawn(ytDlpPath, args);
    ytProcess.stdout.pipe(res);

    ytProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('ERROR:')) console.error('yt-dlp Stream Error:', msg);
    });

    req.on('close', () => {
        if (!ytProcess.killed) ytProcess.kill('SIGKILL');
    });

    ytProcess.on('error', (err) => {
        if (!res.headersSent) {
            res.status(500).json({ status: false, error: 'Lỗi tiến trình stream audio.' });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;