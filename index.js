const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Đường dẫn file yt-dlp binary
const ytDlpPath = path.join(__dirname, 'yt-dlp');

// Lấy Proxy từ biến môi trường (Environment Variable) trên Render HOẶC dán trực tiếp link proxy vào đây
// Ví dụ format: "http://user123:pass123@185.200.100.1:8080" hoặc "socks5://185.200.100.1:1080"
const PROXY_URL = process.env.PROXY_URL || "http://sndjdzty:3bdt86sfpjkc@31.59.20.176:6754";

app.get('/api/audio-stream', (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    // Cấu hình các tham số yt-dlp
    let commandArgs = [
        `"${ytDlpPath}"`,
        `"${videoUrl}"`,
        '--dump-single-json',
        '--no-warnings',
        '--no-check-certificates',
        '--extractor-args "youtube:player_client=android,ios,mweb"'
    ];

    // Nếu cấu hình Proxy, truyền thêm tham số --proxy vào yt-dlp
    if (PROXY_URL && PROXY_URL !== "LINK_PROXY_CUA_BAN_O_DAY") {
        commandArgs.push(`--proxy "${PROXY_URL}"`);
    }

    const command = commandArgs.join(' ');

    exec(command, { maxBuffer: 1024 * 1024 * 15 }, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp Error Details:", stderr || error.message);
            return res.status(500).json({ 
                status: false, 
                error: 'Không thể trích xuất Audio từ YouTube. Hãy kiểm tra lại Proxy hoặc URL.' 
            });
        }

        try {
            const output = JSON.parse(stdout);
            const formats = output.formats || [];

            // Lọc chỉ lấy Stream Audio (vcodec === 'none' và acodec !== 'none')
            const audioFormats = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.url);
            
            // Lấy bản Audio có bitrate/chất lượng tốt nhất
            const bestAudio = audioFormats[audioFormats.length - 1];

            if (!bestAudio) {
                return res.status(404).json({ status: false, message: 'Không tìm thấy Stream Audio' });
            }

            return res.json({
                status: true,
                data: {
                    title: output.title,
                    duration: output.duration,
                    thumbnail: output.thumbnail,
                    audio_url: bestAudio.url, // Link stream direct
                    ext: bestAudio.ext,
                    bitrate: bestAudio.abr || 'N/A'
                }
            });

        } catch (e) {
            console.error("JSON Parse Error:", e.message);
            return res.status(500).json({ status: false, error: 'Lỗi xử lý dữ liệu từ YouTube.' });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;