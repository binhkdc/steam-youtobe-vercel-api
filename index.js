const express = require('express');
const cors = require('cors');
const { execFile, spawn } = require('child_process');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Đường dẫn file yt-dlp binary
const ytDlpPath = path.join(__dirname, 'yt-dlp');

// Proxy URL từ Environment Variable trên Render (hoặc fallback mặc định)
const PROXY_URL = process.env.PROXY_URL || "http://sndjdzty:3bdt86sfpjkc@31.59.20.176:6754";

/**
 * Hàm hỗ trợ gọi yt-dlp lấy thông tin JSON (An toàn hơn với execFile)
 */
function getMetadata(videoUrl, useProxy = true) {
    return new Promise((resolve, reject) => {
        // Mảng tham số nguyên bản, không dùng ngoặc đôi thủ công
        let args = [
            videoUrl,
            '-f "ba[ext=m4a]/ba/bestaudio/b"', 
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

        // Dùng execFile an toàn chống Command Injection và không bị đứt gãy chuỗi tham số
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
 * Endpoint 1: Lấy thông tin video & Direct Link Stream (JSON response)
 * GET /api/info?url=https://www.youtube.com/watch?v=...
 * GET /api/audio-stream?url=https://www.youtube.com/watch?v=...
 */
const handleInfoRequest = async (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    try {
        let output;
        try {
            // Lần 1: Thử gọi qua Proxy
            output = await getMetadata(videoUrl, true);
        } catch (proxyError) {
            console.warn("Proxy gặp sự cố, đang tự động thử lại không dùng Proxy...", proxyError);
            // Lần 2: Fallback thử gọi trực tiếp không qua Proxy
            output = await getMetadata(videoUrl, false);
        }

        // Ưu tiên lấy link direct stream do yt-dlp tự chọn
        let audioUrl = output.url;

        // Nếu output.url không có, chủ động lọc trong danh sách output.formats
        if (!audioUrl && Array.isArray(output.formats) && output.formats.length > 0) {
            // Lọc các format chỉ có Audio (vcodec === 'none')
            const pureAudioFormats = output.formats.filter(
                f => f.vcodec === 'none' && f.acodec !== 'none' && f.url
            );

            if (pureAudioFormats.length > 0) {
                // Ưu tiên chọn định dạng m4a (AAC) để tương thích tốt với thẻ <audio>
                const m4aFormat = pureAudioFormats.find(f => f.ext === 'm4a');
                audioUrl = m4aFormat ? m4aFormat.url : pureAudioFormats[pureAudioFormats.length - 1].url;
            } else {
                // Fallback lấy format bất kỳ có sẵn URL
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
                duration: output.duration,
                author: output.uploader || output.channel || 'N/A',
                thumbnail: output.thumbnail,
                audio_url: audioUrl, // Direct link stream cho HTML5 <audio>
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
        '-f', 'ba[ext=m4a]/ba/bestaudio/b',
        '-o', '-', // Output ra stdout để pipe trực tiếp sang response
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        '--extractor-args', 'youtube:player_client=android,ios,mweb'
    ];

    if (PROXY_URL && typeof PROXY_URL === 'string' && PROXY_URL.startsWith("http")) {
        args.push('--proxy', PROXY_URL);
    }

    // Set Content-Type đúng cho m4a/aac audio
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');

    // Dùng spawn để stream dữ liệu thời gian thực (Real-time Stream)
    const ytProcess = spawn(ytDlpPath, args);

    // Pipe stdout của yt-dlp vào Express response
    ytProcess.stdout.pipe(res);

    ytProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('ERROR:')) {
            console.error('yt-dlp Stream Error:', msg);
        }
    });

    // Xử lý dọn dẹp tiến trình khi người dùng ngắt kết nối (Stop/Seek/Close Tab)
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