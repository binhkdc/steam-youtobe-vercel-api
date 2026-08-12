const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Đường dẫn tới file yt-dlp binary trên Render/Linux
const ytDlpPath = path.join(__dirname, 'yt-dlp');

app.get('/api/audio-stream', (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    // Lệnh thực thi bóc tách thông tin JSON
    const command = `"${ytDlpPath}" "${videoUrl}" --dump-single-json --no-warnings --no-check-certificates`;

    exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp Error:", stderr || error.message);
            return res.status(500).json({ status: false, error: 'Lỗi khi trích xuất Audio Stream từ YouTube.' });
        }

        try {
            const output = JSON.parse(stdout);
            const formats = output.formats || [];

            // Lọc chỉ lấy Stream Audio (vcodec === 'none' & acodec !== 'none')
            const audioFormats = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.url);
            const bestAudio = audioFormats[audioFormats.length - 1]; // Lấy bản audio bitrate tốt nhất

            if (!bestAudio) {
                return res.status(404).json({ status: false, message: 'Không tìm thấy Audio Stream' });
            }

            return res.json({
                status: true,
                data: {
                    title: output.title,
                    duration: output.duration,
                    audio_url: bestAudio.url, // Link nhét trực tiếp vào thẻ <audio>
                    ext: bestAudio.ext
                }
            });

        } catch (e) {
            return res.status(500).json({ status: false, error: 'Lỗi parse dữ liệu JSON từ yt-dlp' });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));