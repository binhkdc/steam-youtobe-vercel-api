const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Đường dẫn file yt-dlp binary
const ytDlpPath = path.join(__dirname, 'yt-dlp');

// Proxy URL từ Environment Variable trên Render
const PROXY_URL = process.env.PROXY_URL || "http://sndjdzty:3bdt86sfpjkc@31.59.20.176:6754";

/**
 * Hàm hỗ trợ gọi yt-dlp lấy thông tin JSON
 */
function getMetadata(videoUrl, useProxy = true) {
    return new Promise((resolve, reject) => {
        let commandArgs = [
            `"${ytDlpPath}"`,
            `"${videoUrl}"`,
            '-f "ba[ext=m4a]/ba/bestaudio/b"',
            '--no-playlist',
            '--skip-download',
            '--no-write-thumbnail',
            '--dump-single-json',
            '--no-warnings',
            '--no-check-certificates',
            '--force-ipv4', // Ép IPv4 để tránh lệch IP giữa v4/v6
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
 * Endpoint 1: Lấy thông tin Metadata bài hát
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
            console.warn("Proxy gặp sự cố, tự động thử lại không dùng Proxy...", proxyError);
            output = await getMetadata(videoUrl, false);
        }

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

        res.setHeader('Cache-Control', 'public, max-age=7200');

        // Khuyên dùng: Client nên dùng stream_proxy_url để dán vào thẻ <audio> tránh bị lỗi 403
        const protocol = req.protocol;
        const host = req.get('host');
        const streamProxyUrl = `${protocol}://${host}/api/stream-audio?url=${encodeURIComponent(videoUrl)}`;

        return res.json({
            status: true,
            data: {
                title: output.title,
                duration: output.duration,
                author: output.uploader || 'N/A',
                thumbnail: output.thumbnail,
                stream_proxy_url: streamProxyUrl, // Dùng link này cho thẻ <audio> là 100% không lo 403
                direct_audio_url: audioUrl,        // Direct URL gốc từ YouTube (có thể bị 403 nếu đổi IP Client)
                ext: output.ext || 'm4a'
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
 * Endpoint 2: Proxy Stream Audio trực tiếp (SỬA LỖI 403 TRIỆT ĐỂ)
 * Dùng URL này gắn thẳng vào src của thẻ <audio> phía Frontend
 */
app.get('/api/stream-audio', (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    let args = [
        videoUrl,
        '-f', 'ba[ext=m4a]/ba/bestaudio',
        '-o', '-', // Stream trực tiếp ra stdout
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        '--force-ipv4',
        '--extractor-args', 'youtube:player_client=android,ios,mweb'
    ];

    if (PROXY_URL && PROXY_URL.startsWith("http")) {
        args.push('--proxy', PROXY_URL);
    }

    // Set Header chuẩn cho browser stream
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache');

    const ytProcess = spawn(ytDlpPath, args);

    // Pipe dữ liệu trực tiếp về Client
    ytProcess.stdout.pipe(res);

    ytProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('ERROR:')) console.error('yt-dlp Stream Error:', msg);
    });

    // Khi người dùng tắt/stop nhạc hoặc đóng tab, ngắt ngay tiến trình yt-dlp để tiết kiệm RAM/CPU trên Render
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