const express = require('express');
const cors = require('cors');
const { execFile, spawn } = require('child_process');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Đường dẫn file yt-dlp binary
const ytDlpPath = path.join(__dirname, 'yt-dlp');

// Proxy URL từ Environment Variable trên Render
const PROXY_URL = process.env.PROXY_URL || "http://sndjdzty:3bdt86sfpjkc@31.59.20.176:6754";

/**
 * Hàm hỗ trợ gọi yt-dlp lấy thông tin JSON (Audio Only)
 */
function getMetadata(videoUrl, useProxy = true) {
    return new Promise((resolve, reject) => {
        // Cú pháp chuẩn docs yt-dlp: Lọc duy nhất Audio
        let args = [
            videoUrl,
            '-f', 'ba[ext=m4a]/ba/bestaudio', // Chỉ lấy Audio stream tốt nhất
            '--no-playlist',
            '--skip-download',
            '--dump-single-json',
            '--no-warnings',
            '--no-check-certificates',
            '--extractor-args', 'youtube:player_client=android,ios,mweb'
        ];

        if (useProxy && typeof PROXY_URL === 'string' && PROXY_URL.startsWith("http")) {
            args.push('--proxy', PROXY_URL);
        }

        execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                return reject(stderr.trim() || error.message);
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
 * Endpoint 1: Lấy thông tin & Direct Link Stream Audio (JSON response)
 * GET /api/info?url=https://www.youtube.com/watch?v=...
 */
const handleInfoRequest = async (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    try {
        let output;
        try {
            output = await getMetadata(videoUrl, true);
        } catch (proxyError) {
            console.warn("Proxy gặp sự cố, thử lại không dùng Proxy...", proxyError);
            output = await getMetadata(videoUrl, false);
        }

        let audioUrl = output.url;

        // Lọc kỹ lại danh sách formats chuẩn Audio Only (vcodec === 'none')
        if (Array.isArray(output.formats) && output.formats.length > 0) {
            const pureAudioFormats = output.formats.filter(
                f => f.vcodec === 'none' && f.acodec !== 'none' && f.url
            );

            if (pureAudioFormats.length > 0) {
                // Ưu tiên m4a (AAC) cho HTML5 audio player
                const m4aFormat = pureAudioFormats.find(f => f.ext === 'm4a');
                audioUrl = m4aFormat ? m4aFormat.url : pureAudioFormats[pureAudioFormats.length - 1].url;
            }
        }

        if (!audioUrl) {
            return res.status(404).json({ status: false, message: 'Không tìm thấy đường dẫn Audio Stream phù hợp.' });
        }

        res.setHeader('Cache-Control', 'public, max-age=7200');

        return res.json({
            status: true,
            data: {
                title: output.title,
                duration: output.duration,
                author: output.uploader || output.channel || 'N/A',
                thumbnail: output.thumbnail,
                audio_url: audioUrl,
                ext: output.ext || 'm4a',
                filesize: output.filesize || output.filesize_approx || null
            }
        });

    } catch (finalError) {
        console.error("Final yt-dlp Error:", finalError);
        return res.status(500).json({ 
            status: false, 
            error: 'Không thể trích xuất Audio từ YouTube.' 
        });
    }
};

app.get('/api/info', handleInfoRequest);
app.get('/api/audio-stream', handleInfoRequest);

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
        '-f', 'ba[ext=m4a]/ba/bestaudio', // Ép chỉ chọn Audio
        '-x',                             // Extract Audio (Loại bỏ luồng video hoàn toàn)
        '-o', '-',                        // Pipe trực tiếp ra stdout
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        '--extractor-args', 'youtube:player_client=android,ios,mweb'
    ];

    if (PROXY_URL && typeof PROXY_URL === 'string' && PROXY_URL.startsWith("http")) {
        args.push('--proxy', PROXY_URL);
    }

    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');

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
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;