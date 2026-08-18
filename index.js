const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

const ytDlpPath = path.join(__dirname, 'yt-dlp');
const PROXY_URL = process.env.PROXY_URL || 'http://sndjdzty:3bdt86sfpjkc@31.59.20.176:6754';
const AUDIO_FORMAT_PREFERENCE = 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best';

function runYtDlp(args, useProxy = true) {
    return new Promise((resolve, reject) => {
        const commandArgs = [...args];

        if (useProxy && PROXY_URL && PROXY_URL.startsWith('http')) {
            commandArgs.push('--proxy', PROXY_URL);
        }

        const ytProc = spawn(ytDlpPath, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';

        ytProc.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        ytProc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        ytProc.on('error', (error) => reject(error));
        ytProc.on('close', (code) => {
            if (code !== 0) {
                return reject(stderr.trim() || `yt-dlp exited with code ${code}`);
            }

            try {
                resolve(stdout.trim());
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function getAudioInfo(videoUrl, useProxy = true) {
    const jsonString = await runYtDlp([
        videoUrl,
        '-f', AUDIO_FORMAT_PREFERENCE,
        '--no-playlist',
        '--skip-download',
        '--dump-single-json',
        '--no-warnings',
        '--no-check-certificates',
        '--extractor-args', 'youtube:player_client=android,ios,mweb'
    ], useProxy);

    const output = JSON.parse(jsonString);
    const audioCandidates = (output.formats || []).filter(
        (format) => format.vcodec === 'none' && format.acodec && format.url
    );

    const bestAudio = audioCandidates.sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0];

    return {
        ...output,
        audio_url: bestAudio?.url || output.url,
        ext: bestAudio?.ext || output.ext || 'm4a',
        mime_type: bestAudio?.ext === 'webm' ? 'audio/webm' : 'audio/mp4'
    };
}

async function resolveAudio(videoUrl) {
    try {
        return await getAudioInfo(videoUrl, true);
    } catch (proxyError) {
        console.warn('Proxy lỗi, thử lại không dùng proxy...', proxyError);
        return await getAudioInfo(videoUrl, false);
    }
}

function streamAudioToClient(req, res, directAudioUrl, mimeType) {
    if (!directAudioUrl) {
        return res.status(404).json({ status: false, error: 'Không tìm thấy URL audio.' });
    }

    const client = directAudioUrl.startsWith('https') ? https : http;
    const parsedUrl = new URL(directAudioUrl);
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: '*/*'
    };

    if (req.headers.range) {
        headers.Range = req.headers.range;
    }

    const reqOptions = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers
    };

    const proxyReq = client.request(reqOptions, (proxyRes) => {
        res.status(proxyRes.statusCode || 200);
        res.setHeader('Content-Type', proxyRes.headers['content-type'] || mimeType);
        res.setHeader('Accept-Ranges', 'bytes');

        if (proxyRes.headers['content-length']) {
            res.setHeader('Content-Length', proxyRes.headers['content-length']);
        }

        if (proxyRes.headers['content-range']) {
            res.setHeader('Content-Range', proxyRes.headers['content-range']);
        }

        proxyRes.pipe(res);

        req.on('close', () => {
            proxyReq.destroy();
        });
    });

    proxyReq.on('error', (err) => {
        console.error('Stream proxy error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ status: false, error: 'Lỗi truyền tải audio.' });
        }
    });

    proxyReq.end();
}

const handleInfoRequest = async (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    try {
        const output = await resolveAudio(videoUrl);

        if (!output.audio_url) {
            return res.status(404).json({
                status: false,
                message: 'Không tìm thấy đường dẫn stream audio phù hợp.'
            });
        }

        res.setHeader('Cache-Control', 'public, max-age=7200');

        return res.json({
            status: true,
            data: {
                title: output.title,
                duration: output.duration,
                author: output.uploader || output.channel || 'N/A',
                thumbnail: output.thumbnail,
                audio_url: output.audio_url,
                ext: output.ext,
                mime_type: output.mime_type,
                filesize: output.filesize || output.filesize_approx || null
            }
        });
    } catch (error) {
        console.error('Final yt-dlp Error:', error);
        return res.status(500).json({
            status: false,
            error: 'Không thể trích xuất audio-only từ YouTube. Hãy kiểm tra URL hoặc proxy.'
        });
    }
};

app.get('/api/info', handleInfoRequest);
app.get('/api/audio-stream', handleInfoRequest);
app.get('/api/audio', handleInfoRequest);

app.get('/api/stream-audio', async (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    try {
        const output = await resolveAudio(videoUrl);
        streamAudioToClient(req, res, output.audio_url, output.mime_type || 'audio/mp4');
    } catch (error) {
        console.error('Stream audio error:', error);
        return res.status(500).json({
            status: false,
            error: 'Không thể tạo stream audio-only.'
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;