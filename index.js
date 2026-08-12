const express = require('express');
const cors = require('cors');
const { Innertube, UniversalCache } = require('youtubei.js');

const app = express();

app.use(cors());
app.use(express.json());

let youtube;

// Khởi tạo Innertube Instance (Cache dữ liệu để tối ưu tốc độ)
async function getYouTubeClient() {
    if (!youtube) {
        youtube = await Innertube.create({
            cache: new UniversalCache(false),
            generate_session_locale: 'en-US'
        });
    }
    return youtube;
}

// Hàm hỗ trợ trích xuất Video ID từ URL
function extractVideoId(url) {
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    return match ? match[1] : null;
}

/**
 * Endpoint: Lấy thông tin video & Direct Stream Link
 * GET /api/info?url=https://www.youtube.com/watch?v=...
 */
app.get('/api/info', async (req, res) => {
    try {
        const videoUrl = req.query.url;
        if (!videoUrl) {
            return res.status(400).json({ status: false, message: 'Thiếu tham số url' });
        }

        const videoId = extractVideoId(videoUrl);
        if (!videoId) {
            return res.status(400).json({ status: false, message: 'URL YouTube không hợp lệ' });
        }

        const yt = await getYouTubeClient();
        
        // Lấy thông tin chi tiết của Video từ YouTube Innertube Engine
        const info = await yt.getBasicInfo(videoId);
        const streamingData = info.streaming_data;

        if (!streamingData) {
            return res.status(404).json({ status: false, message: 'Không tìm thấy dữ liệu Stream cho Video này' });
        }

        // Lọc định dạng Combo Video + Audio
        const combinedFormats = streamingData.formats || [];
        const bestCombined = combinedFormats[combinedFormats.length - 1]; // Lấy chất lượng cao nhất trong mảng combined

        // Lọc định dạng Audio riêng
        const adaptiveFormats = streamingData.adaptive_formats || [];
        const bestAudio = adaptiveFormats
            .filter(f => f.mime_type && f.mime_type.includes('audio'))
            .pop();

        return res.json({
            status: true,
            data: {
                title: info.basic_info.title,
                duration: info.basic_info.duration,
                author: info.basic_info.author,
                thumbnail: info.basic_info.thumbnail?.[0]?.url,
                // Link Direct Stream phát được trực tiếp
                stream_url: bestCombined ? bestCombined.decipher(yt.session) : null,
                audio_url: bestAudio ? bestAudio.decipher(yt.session) : null
            }
        });

    } catch (error) {
        return res.status(500).json({ status: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;