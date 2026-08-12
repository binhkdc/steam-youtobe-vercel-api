const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const ytDlpPath = path.join(__dirname, 'yt-dlp');
const PROXY_URL = process.env.PROXY_URL || "http://sndjdzty:3bdt86sfpjkc@31.59.20.176:6754";

app.get('/api/audio-stream', (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
    }

    // TỐI ƯU CÁC CỜ LỆNH (COMMAND FLAGS)
    let commandArgs = [
        `"${ytDlpPath}"`,
        `"${videoUrl}"`,
        // Ép lấy định dạng Audio duy nhất có bitrate cao nhất (m4a, webm, opus...)
        '-f "ba[ext=m4a]/ba/bestaudio"', 
        '--no-playlist',             // Không quét playlist nếu url là danh sách phát (tăng tốc)
        '--skip-download',           // Bỏ qua việc tải xuống
        '--dump-single-json',        // Trả về JSON gọn
        '--no-warnings',
        '--no-check-certificates',
        '--extractor-args "youtube:player_client=android,ios,mweb"'
    ];

    if (PROXY_URL && PROXY_URL.startsWith("http")) {
        commandArgs.push(`--proxy "${PROXY_URL}"`);
    }

    const command = commandArgs.join(' ');

    // Giảm bớt maxBuffer vì JSON audio-only cực nhẹ
    exec(command, { maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp Error Details:", stderr || error.message);
            return res.status(500).json({ status: false, error: 'Không thể trích xuất Audio.' });
        }

        try {
            const output = JSON.parse(stdout);
            
            // Tìm URL direct stream audio
            let audioUrl = output.url;

            if (!audioUrl && output.formats) {
                // Lọc chính xác những format CHỈ CÓ AUDIO (vcodec === 'none')
                const pureAudioFormats = output.formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.url);
                if (pureAudioFormats.length > 0) {
                    audioUrl = pureAudioFormats[pureAudioFormats.length - 1].url;
                }
            }

            if (!audioUrl) {
                return res.status(404).json({ status: false, message: 'Không tìm thấy Audio Stream phù hợp.' });
            }

            // TỐI ƯU CACHE: Báo trình duyệt / CDN cache lại kết quả trong 2 tiếng
            res.setHeader('Cache-Control', 'public, max-age=7200');

            // TRẢ VỀ DỮ LIỆU TINH GỌN (Chỉ các trường cần thiết cho Player)
            return res.json({
                status: true,
                data: {
                    title: output.title,
                    duration: output.duration,       // Độ dài (giây)
                    thumbnail: output.thumbnail,     // Ảnh bìa bài hát
                    audio_url: audioUrl,             // Link direct stream
                    ext: output.ext || 'm4a',        // Đuôi file (.m4a, .webm)
                    filesize: output.filesize || output.filesize_approx || null // Dung lượng dự kiến
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