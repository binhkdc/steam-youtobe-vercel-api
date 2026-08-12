const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Đường dẫn tới file yt-dlp binary được tải về trong bước Build
const ytDlpPath = path.join(__dirname, 'yt-dlp');

app.get('/api/audio-stream', (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    // Các tham số kích hoạt Client ít bị quét Bot trên Datacenter
    const commandArgs = [
        `"${ytDlpPath}"`,
        `"${videoUrl}"`,
        '--dump-single-json',
        '--no-warnings',
        '--no-check-certificates',
        '--extractor-args "youtube:player_client=android_creator,mweb,ios,tv_embedded"'
    ];

    const command = commandArgs.join(' ');

    // Thực thi yt-dlp với bộ đệm maxBuffer 15MB để tránh văng lỗi khi JSON dài
    exec(command, { maxBuffer: 1024 * 1024 * 15 }, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp Error Details:", stderr || error.message);
            return res.status(500).json({ 
                status: false, 
                error: 'Không thể trích xuất Audio từ YouTube. Vui lòng thử lại sau.' 
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
                    audio_url: bestAudio.url, // Link direct paste trực tiếp vào thẻ <audio src="...">
                    ext: bestAudio.ext,
                    bitrate: bestAudio.abr || 'N/A'
                }
            });

        } catch (e) {
            console.error("JSON Parse Error:", e.message);
            return res.status(500).json({ status: false, error: 'Lỗi xử lý dữ liệu JSON từ YouTube.' });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;