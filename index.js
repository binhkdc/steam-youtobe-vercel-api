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
            '-f "ba[ext=m4a]/ba[ext=webm]/ba/bestaudio/best"',
            '--no-playlist',
            '--skip-download',
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
app.get('/api/stream-audio-old', (req, res) => {
   const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    try {
        // BƯỚC 1: Lấy URL Direct Stream và Info từ yt-dlp dạng JSON
        let args = [
            videoUrl,
            '-f', 'ba[ext=m4a]/ba/bestaudio',
            '--dump-single-json',
            '--no-playlist',
            '--no-warnings',
            '--no-check-certificates',
            '--cookies', './cookies.txt', // 👈 THÊM DÒNG NÀY (đặt file cookies.txt cùng thư mục dự án)
            '--extractor-args', 'youtube:player_client=android,ios,mweb'
        ];

        if (PROXY_URL && PROXY_URL.startsWith("http")) {
            args.push('--proxy', PROXY_URL);
        }

        // Nếu có file cookies trên Linux VPS thì thêm vào
        // args.push('--cookies', COOKIES_PATH);

        const ytProc = spawn(ytDlpPath, args);
        let stdoutData = '';
        let stderrData = '';

        ytProc.stdout.on('data', (chunk) => { stdoutData += chunk; });
        ytProc.stderr.on('data', (chunk) => { stderrData += chunk; });

        ytProc.on('close', (code) => {
            if (code !== 0 || !stdoutData) {
                console.error('yt-dlp Error:', stderrData);
                return res.status(500).json({ status: false, error: 'Không thể lấy thông tin stream.' });
            }

            try {
                const info = JSON.parse(stdoutData);
                const directAudioUrl = info.url; // Đường dẫn stream gốc từ YouTube CDN
                const mimeType = info.ext === 'm4a' ? 'audio/mp4' : (info.ext === 'webm' ? 'audio/webm' : 'audio/mpeg');

                if (!directAudioUrl) {
                    return res.status(404).json({ status: false, error: 'Không tìm thấy URL Audio.' });
                }

                // BƯỚC 2: Forward Request sang YouTube CDN có hỗ trợ HTTP Range (Tua nhạc)
                const client = directAudioUrl.startsWith('https') ? https : http;
                const parsedUrl = new URL(directAudioUrl);

                const reqHeaders = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': '*/*',
                };

                // Chuyển tiếp Range Header từ App/Trình duyệt sang YouTube CDN để tua nhạc
                if (req.headers.range) {
                    reqHeaders['Range'] = req.headers.range;
                }

                const options = {
                    hostname: parsedUrl.hostname,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'GET',
                    headers: reqHeaders
                };

                const proxyReq = client.request(options, (proxyRes) => {
                    // Trả lại đúng Status Code (200 hoặc 206 Partial Content)
                    res.status(proxyRes.statusCode);

                    // Thiết lập đúng Headers trả về cho Client
                    res.setHeader('Content-Type', proxyRes.headers['content-type'] || mimeType);
                    res.setHeader('Accept-Ranges', 'bytes');

                    if (proxyRes.headers['content-length']) {
                        res.setHeader('Content-Length', proxyRes.headers['content-length']);
                    }
                    if (proxyRes.headers['content-range']) {
                        res.setHeader('Content-Range', proxyRes.headers['content-range']);
                    }

                    // Nối luồng stream dữ liệu
                    proxyRes.pipe(res);

                    req.on('close', () => {
                        proxyReq.destroy();
                    });
                });

                proxyReq.on('error', (err) => {
                    console.error('Proxy Error:', err.message);
                    if (!res.headersSent) {
                        res.status(500).json({ status: false, error: 'Lỗi truyền tải stream.' });
                    }
                });

                proxyReq.end();

            } catch (e) {
                console.error('JSON Parse Error:', e);
                return res.status(500).json({ status: false, error: 'Lỗi xử lý dữ liệu stream.' });
            }
        });

    } catch (err) {
        console.error('Server Internal Error:', err);
        res.status(500).json({ status: false, error: 'Lỗi hệ thống.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;