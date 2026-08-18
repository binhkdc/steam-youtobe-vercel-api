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
const PROXY_URL = process.env.PROXY_URL || "http://sndjdzty:3bdt86sfpjkc@31.56.127.193:7684";

/**
 * Hàm hỗ trợ gọi yt-dlp lấy thông tin JSON (Trả về Promise)
 */
function getMetadata(videoUrl, useProxy = true) {
    return new Promise((resolve, reject) => {
        const args = [
            videoUrl,
            '-f', 'ba[ext=m4a]/ba[ext=webm]/ba/bestaudio/best',
            '--no-playlist',
            '--skip-download',
            '--dump-single-json',
            '--no-warnings',
            '--no-check-certificates',
            '--extractor-args', 'youtube:player_client=android,android_vr,mweb,tv_downgraded'
        ];

        if (useProxy && PROXY_URL && PROXY_URL.startsWith("http")) {
            args.push('--proxy', PROXY_URL);
        }

        const process = spawn(ytDlpPath, args, { maxBuffer: 10 * 1024 * 1024 });

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => stdout += data.toString());
        process.stderr.on('data', (data) => stderr += data.toString());

        if (code !== 0) {
                console.error('=== yt-dlp STDERR ===');
                console.error(stderr);
                console.error('=====================');
                return reject(stderr || `yt-dlp exited with code ${code}`);
            }

                process.on('error', (err) => reject(err.message));
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
        let audioUrl = null;

        // Ưu tiên format pure audio (vcodec = none)
        if (output.formats && output.formats.length > 0) {
            const pureAudio = output.formats
                .filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.url)
                .sort((a, b) => (b.abr || 0) - (a.abr || 0)); // bitrate cao nhất

            if (pureAudio.length > 0) {
                audioUrl = pureAudio[0].url;
            }
        }

        // Fallback nếu vẫn không có
        if (!audioUrl) {
            audioUrl = output.url;
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
                duration: output.duration,
                author: output.uploader || output.channel || 'N/A',
                thumbnail: output.thumbnail,
                audio_url: audioUrl,                   // Direct link stream cho HTML5 <audio>
                ext: output.ext || 'm4a',
                filesize: output.filesize || output.filesize_approx || null
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
        '-f', 'ba[ext=m4a]/ba[ext=webm]/ba/bestaudio',  // ← chỉ audio
        '-o', '-',
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        '--extractor-args', 'youtube:player_client=android,ios,mweb'
    ];

    if (PROXY_URL && PROXY_URL.startsWith("http")) {
        args.push('--proxy', PROXY_URL);
    }

    // Content-Type linh hoạt hơn (m4a hoặc webm đều được)
    res.setHeader('Content-Type', 'audio/mp4'); // hoặc 'audio/webm'
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache');

    const ytProcess = spawn(ytDlpPath, args);

    ytProcess.stdout.pipe(res);

    ytProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('ERROR:')) {
            console.error('yt-dlp Stream Error:', msg);
        }
    });

    req.on('close', () => {
        if (!ytProcess.killed) {
            ytProcess.kill('SIGKILL');
        }
    });

    ytProcess.on('error', (err) => {
        console.error('Process Error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ status: false, error: 'Lỗi tiến trình stream audio.' });
        }
    });

    ytProcess.on('close', (code) => {
        if (code !== 0 && !res.headersSent) {
            res.status(500).json({ status: false, error: 'yt-dlp kết thúc với lỗi' });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;