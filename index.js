const express = require('express');
const cors = require('cors');
const ytDlp = require('yt-dlp-exec');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/audio-stream', async (req, res) => {
    try {
        const videoUrl = req.query.url;

        if (!videoUrl) {
            return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
        }

        // Gọi yt-dlp lấy thông tin các stream
        const output = await ytDlp(videoUrl, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: [
                'referer:youtube.com',
                'user-agent:googlebot'
            ]
        });

        const formats = output.formats || [];
        
        // CHỈ LỌC AUDIO: Lấy format không có video (vcodec === 'none') và có audio (acodec !== 'none')
        // Sắp xếp chọn bitrate/chất lượng audio tốt nhất
        const audioFormats = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.url);
        const bestAudio = audioFormats[audioFormats.length - 1]; // Lấy bản audio chất lượng cao nhất

        if (!bestAudio) {
            return res.status(404).json({ status: false, message: 'Không tìm thấy Stream Audio' });
        }

        return res.json({
            status: true,
            data: {
                title: output.title,
                audio_url: bestAudio.url, // Link direct audio nhét thẳng vào <audio src="...">
                ext: bestAudio.ext,       // Thường là m4a hoặc webm
                filesize: bestAudio.filesize || bestAudio.filesize_approx
            }
        });

    } catch (error) {
        console.error("yt-dlp Audio Error:", error.message);
        return res.status(500).json({ 
            status: false, 
            error: 'Không thể trích xuất Audio. Vui lòng kiểm tra lại URL.' 
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Audio Server running on http://localhost:${PORT}`));

module.exports = app;