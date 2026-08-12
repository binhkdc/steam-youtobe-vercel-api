const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const ytDlpPath = path.join(__dirname, 'yt-dlp');
const cookiePath = path.join(__dirname, 'cookies.txt');

app.get('/api/audio-stream', (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    const hasCookies = fs.existsSync(cookiePath);

    // Cấu hình các client di động/TV vượt tường rào Datacenter
    let commandArgs = [
        `"${ytDlpPath}"`,
        `"${videoUrl}"`,
        '--dump-single-json',
        '--no-warnings',
        '--no-check-certificates',
        // Chọn danh sách client ít bị quét bot nhất
        '--extractor-args "youtube:player_client=android_creator,tv,web_embedded"'
    ];

    if (hasCookies) {
        commandArgs.push(`--cookies "${cookiePath}"`);
    }

    const command = commandArgs.join(' ');

    exec(command, { maxBuffer: 1024 * 1024 * 15 }, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp Error Details:", stderr || error.message);
            return res.status(500).json({ 
                status: false, 
                error: 'Không thể trích xuất Audio từ YouTube. Cần cập nhật cookies.txt hoặc PO-Token.' 
            });
        }

        try {
            const output = JSON.parse(stdout);
            const formats = output.formats || [];

            const audioFormats = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.url);
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
                    audio_url: bestAudio.url,
                    ext: bestAudio.ext
                }
            });

        } catch (e) {
            return res.status(500).json({ status: false, error: 'Lỗi xử lý dữ liệu từ YouTube.' });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;