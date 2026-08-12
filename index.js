const express = require('express');
const cors = require('cors');
const { Innertube, UniversalCache } = require('youtubei.js');

const app = express();

app.use(cors());
app.use(express.json());

// Hàm trích xuất Video ID từ URL
function extractVideoId(url) {
    if (!url) return null;
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
        const videoId = extractVideoId(videoUrl);

        if (!videoId) {
            return res.status(400).json({ status: false, message: 'URL YouTube không hợp lệ' });
        }

        // Khởi tạo Innertube riêng cho mỗi invocation để tránh lỗi state trên Serverless
        const yt = await Innertube.create({
            cache: new UniversalCache(false),
            generate_session_locale: 'en-US'
        });

        // Lấy thông tin video
        const info = await yt.getBasicInfo(videoId);
        const streamingData = info.streaming_data;

        if (!streamingData) {
            return res.status(404).json({ status: false, message: 'Không tìm thấy dữ liệu Stream' });
        }

        // Lọc lấy Video+Audio combo và Audio riêng
        const combinedFormats = streamingData.formats || [];
        const bestCombined = combinedFormats[combinedFormats.length - 1];

        const adaptiveFormats = streamingData.adaptive_formats || [];
        const bestAudio = adaptiveFormats
            .filter(f => f.mime_type && f.mime_type.includes('audio'))
            .pop();

        // Lấy url trực tiếp (sử dụng async decipher)
        const streamUrl = bestCombined ? await bestCombined.decipher(yt.session) : null;
        const audioUrl = bestAudio ? await bestAudio.decipher(yt.session) : null;

        return res.json({
            status: true,
            data: {
                title: info.basic_info.title,
                duration: info.basic_info.duration,
                author: info.basic_info.author,
                thumbnail: info.basic_info.thumbnail?.[0]?.url,
                stream_url: streamUrl,
                audio_url: audioUrl
            }
        });

    } catch (error) {
        // In ra console log để xem trong Vercel Dashboard nếu vẫn lỗi
        console.error("API Error:", error);
        return res.status(500).json({ status: false, error: error.message || 'Internal Error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;