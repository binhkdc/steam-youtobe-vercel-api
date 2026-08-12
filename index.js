const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Đường dẫn tới file yt-dlp binary
const ytDlpPath = path.join(__dirname, 'yt-dlp');

app.get('/api/audio-stream', (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    // Các tham số tối ưu hóa cho YouTube Audio Stream + OAuth2
    const commandArgs = [
        `"${ytDlpPath}"`,
        `"${videoUrl}"`,
        '--username "oauth2"',
        '--password ""',
        '--dump-single-json',
        '--no-warnings',
        '--no-check-certificates',
        '--extractor-args "youtube:player_client=android,ios,web"'
    ];

    const command = commandArgs.join(' ');

    // Thực thi yt-dlp
    exec(command, { maxBuffer: 1024 * 1024 * 15 }, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp Error Details:", stderr || error.message);
            return res.status(500).json({ 
                status: false, 
                error: 'Không thể trích xuất Audio từ YouTube. Hãy kiểm tra Logs trên Render để kích hoạt OAuth2 nếu đây là lần đầu chạy.' 
            });
        }

        try {
            const output = JSON.parse(stdout);
            const formats = output.formats || [];

            // Lọc lấy duy nhất Stream Audio (vcodec === 'none' và acodec !== 'none')
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
                    audio_url: bestAudio.url, // Link direct nhét thẳng vào thẻ <audio>
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