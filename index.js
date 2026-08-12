const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Đường dẫn file thực thi yt-dlp và file cookies
const ytDlpPath = path.join(__dirname, 'yt-dlp');
const cookiePath = path.join(__dirname, 'cookies.txt');

app.get('/api/audio-stream', (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    // Tự động kiểm tra file cookies.txt có tồn tại không
    const hasCookies = fs.existsSync(cookiePath);
    
    // Cấu hình danh sách tham số gửi cho yt-dlp
    let commandArgs = [
        `"${ytDlpPath}"`,
        `"${videoUrl}"`,
        '--dump-single-json',
        '--no-warnings',
        '--no-check-certificates',
        // Ép yt-dlp dùng các Player Client di động để tránh bị quét Bot
        '--extractor-args "youtube:player_client=ios,android,web_creator"'
    ];

    // Nếu có file cookies.txt, ưu tiên truyền thêm tham số cookie
    if (hasCookies) {
        commandArgs.push(`--cookies "${cookiePath}"`);
    }

    const command = commandArgs.join(' ');

    // Thực thi lệnh yt-dlp
    exec(command, { maxBuffer: 1024 * 1024 * 15 }, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp Error Details:", stderr || error.message);
            return res.status(500).json({ 
                status: false, 
                error: 'Không thể trích xuất Audio từ YouTube. Hãy kiểm tra lại URL hoặc cập nhật cookies.txt.' 
            });
        }

        try {
            const output = JSON.parse(stdout);
            const formats = output.formats || [];

            // Lọc chỉ lấy Stream Audio (vcodec === 'none' và acodec !== 'none')
            const audioFormats = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.url);
            
            // Chọn bản Audio có chất lượng/bitrate tốt nhất
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
                    audio_url: bestAudio.url, // URL direct stream phát qua thẻ <audio>
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