const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Đường dẫn file yt-dlp binary
const ytDlpPath = path.join(__dirname, 'yt-dlp');

// Proxy URL từ Environment Variable hoặc điền trực tiếp
const PROXY_URL = process.env.PROXY_URL || "http://sndjdzty:3bdt86sfpjkc@31.59.20.176:6754";

app.get('/api/audio-stream', (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    // Lệnh yt-dlp tối ưu lấy định dạng audio tốt nhất (f bestaudio/best)
    let commandArgs = [
        `"${ytDlpPath}"`,
        `"${videoUrl}"`,
        '-f "bestaudio/best"', // Ép yt-dlp ưu tiên chọn ngay format audio tốt nhất
        '--dump-single-json',
        '--no-warnings',
        '--no-check-certificates',
        '--extractor-args "youtube:player_client=android,ios,mweb"'
    ];

    if (PROXY_URL && PROXY_URL.startsWith("http")) {
        commandArgs.push(`--proxy "${PROXY_URL}"`);
    }

    const command = commandArgs.join(' ');

    exec(command, { maxBuffer: 1024 * 1024 * 15 }, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp Error Details:", stderr || error.message);
            return res.status(500).json({ 
                status: false, 
                error: 'Không thể bóc tách dữ liệu từ YouTube.' 
            });
        }

        try {
            const output = JSON.parse(stdout);
            
            // 1. Tìm đường dẫn stream trực tiếp từ output đã được yt-dlp chọn lọc (-f bestaudio/best)
            let audioUrl = output.url;

            // 2. Nếu output.url không có, duyệt danh sách formats tìm bản Audio tốt nhất
            if (!audioUrl && output.formats && output.formats.length > 0) {
                const formats = output.formats;
                
                // Lọc format chỉ chứa Audio
                const audioFormats = formats.filter(f => f.acodec && f.acodec !== 'none' && f.url);
                
                if (audioFormats.length > 0) {
                    // Ưu tiên bản audio-only (không có video)
                    const pureAudio = audioFormats.filter(f => f.vcodec === 'none');
                    const targetFormat = pureAudio.length > 0 ? pureAudio[pureAudio.length - 1] : audioFormats[0];
                    audioUrl = targetFormat.url;
                }
            }

            if (!audioUrl) {
                return res.status(404).json({ status: false, message: 'Không tìm thấy đường dẫn Stream Audio phù hợp.' });
            }

            return res.json({
                status: true,
                data: {
                    title: output.title,
                    duration: output.duration,
                    thumbnail: output.thumbnail,
                    audio_url: audioUrl, // Link cắm trực tiếp vào thẻ <audio src="...">
                    ext: output.ext || 'm4a'
                }
            });

        } catch (e) {
            console.error("JSON Parse Error:", e.message);
            return res.status(500).json({ status: false, error: 'Lỗi parse dữ liệu JSON.' });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;