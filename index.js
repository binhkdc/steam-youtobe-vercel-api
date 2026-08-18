const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

function resolveYtDlpExecutable() {
    const candidates = [
        path.join(__dirname, 'yt-dlp'),
        path.join(__dirname, 'yt-dlp.exe'),
        path.join(__dirname, 'yt-dlp.cmd')
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return path.join(__dirname, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

const ytDlpPath = resolveYtDlpExecutable();
const PROXY_URL = process.env.PROXY_URL || 'http://sndjdzty:3bdt86sfpjkc@31.59.20.176:6754';
const AUDIO_FORMAT_PREFERENCE = 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best';
const MAX_AUDIO_RETRIES = 2;

function runYtDlp(args, useProxy = true) {
    return new Promise((resolve, reject) => {
        const commandArgs = [...args];

        if (useProxy && PROXY_URL && PROXY_URL.startsWith('http')) {
            commandArgs.push('--proxy', PROXY_URL);
        }

        console.log('[yt-dlp] start', JSON.stringify({ useProxy, args: commandArgs.slice(0, 6) }));

        const ytProc = spawn(ytDlpPath, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';

        ytProc.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        ytProc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        ytProc.on('error', (error) => {
            console.error('[yt-dlp] spawn error', error.message);
            reject(error);
        });

        ytProc.on('close', (code) => {
            if (code !== 0) {
                const details = (stderr || '').trim() || `yt-dlp exited with code ${code}`;
                console.error('[yt-dlp] fail', { code, useProxy, details });
                return reject(details);
            }

            try {
                const trimmed = stdout.trim();
                console.log('[yt-dlp] success', { useProxy, length: trimmed.length });
                resolve(trimmed);
            } catch (error) {
                console.error('[yt-dlp] parse error', error.message);
                reject(error);
            }
        });
    });
}

function isAudioFormat(format) {
    if (!format || !format.url) return false;

    const mime = (format.mime_type || format.mime || '').toLowerCase();
    const vcodec = String(format.vcodec || '').toLowerCase();
    const acodec = String(format.acodec || '').toLowerCase();

    const isAudioMime = mime.includes('audio');
    const isExplicitAudio = vcodec === 'none' && acodec !== 'none';
    const isPossibleAudioFromM4a = mime.includes('audio') || (vcodec === 'none' && !acodec.includes('none'));

    return isAudioMime || isExplicitAudio || isPossibleAudioFromM4a;
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
    const audioCandidates = (output.formats || []).filter((format) => isAudioFormat(format));
    const bestAudio = audioCandidates.sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0];

    const fallbackAudioUrl = output.url && String(output.url).includes('googlevideo.com') && String(output.url).includes('mime=video')
        ? null
        : output.url;

    if (!bestAudio && !fallbackAudioUrl) {
        throw new Error('No valid audio stream found in yt-dlp result.');
    }

    return {
        ...output,
        audio_url: bestAudio?.url || fallbackAudioUrl,
        ext: bestAudio?.ext || output.ext || 'm4a',
        mime_type: bestAudio?.ext === 'webm' ? 'audio/webm' : 'audio/mp4'
    };
}

async function resolveAudio(videoUrl) {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_AUDIO_RETRIES; attempt += 1) {
        const useProxy = attempt === 1;

        try {
            console.log('[resolveAudio] try', { attempt, useProxy, videoUrl });
            return await getAudioInfo(videoUrl, useProxy);
        } catch (error) {
            lastError = error;
            console.warn('[resolveAudio] failed', { attempt, useProxy, message: String(error) });

            if (attempt < MAX_AUDIO_RETRIES) {
                continue;
            }
        }
    }

    throw lastError || new Error('resolveAudio failed');
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

        if (!output.audio_url || String(output.audio_url).includes('storyboard') || String(output.audio_url).includes('mime=video') || String(output.audio_url).includes('itag=18') || String(output.audio_url).includes('videoplayback') && !String(output.audio_url).includes('mime=audio')) {
            return res.status(404).json({
                status: false,
                message: 'Không tìm thấy đường dẫn stream audio thực sự.'
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

app.get('/health', (req, res) => {
    res.json({
        status: true,
        message: 'ok',
        ytDlpPath,
        proxyConfigured: !!(PROXY_URL && PROXY_URL.startsWith('http'))
    });
});

app.get('/test-audio', (req, res) => {
    res.sendFile(path.join(__dirname, 'test-audio.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;