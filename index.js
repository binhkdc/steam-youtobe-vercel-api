const express = require('express');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core');

const app = express();

// 1. Mảng Cookies để bypass Bot Detection từ YouTube
const ytCookies = [
  { domain: ".youtube.com", name: "GPS", value: "1" },
  { domain: ".youtube.com", name: "__Secure-1PSIDTS", value: "sidts-CjQBPWEu2cvTyZ9Q2AX1-2zekELdU6iVBdHbA2sGVka2_GYFkjcctd0qCY5_H0BrlZctoyIAEAA" },
  { domain: ".youtube.com", name: "__Secure-3PSIDTS", value: "sidts-CjQBPWEu2cvTyZ9Q2AX1-2zekELdU6iVBdHbA2sGVka2_GYFkjcctd0qCY5_H0BrlZctoyIAEAA" },
  { domain: ".youtube.com", name: "__Secure-3PAPISID", value: "L7gGUT-IwUtR7KdY/AQ1GrlDAnZumg2DTs" },
  { domain: ".youtube.com", name: "__Secure-3PSID", value: "g.a000BAlprmen2kJn_TDio-UJa66vYu21bQ5RMwqz3gSB-gVYkq1tczd8sLUaovC48TJ3mWsJjwACgYKAWISARQSFQHGX2Mi_1fEgt2WnVWDOotmveyR9hoVAUF8yKrmnGVMmkhpuMwi2JEK8m7Z0076" },
  { domain: ".youtube.com", name: "PREF", value: "tz=Etc.GMT-7" },
  { domain: ".youtube.com", name: "LOGIN_INFO", value: "AFmmF2swRQIhAJZnX75iL9bpPllsYzhjel-wHyFpVmvnSpMl0mXSiAvOAiBiOGeETRaj875NDRvuGGtVtO19UaiUteOsKYrTLuQOdA:QUQ3MjNmekxPZDZTcWdpcU9UWm9qTFFnZnRqLWZkSTFEWDBpcDZmZTE2Y2xrQnQwY0RBQTdvQ09Vb00yX09CSTN3V0lvV0Uzb3pfYi12dEtIR2x0d29Vc1FwY1pDVHRKeWUyLUZ0NGRYNmRZQTY4amVrWndiUV85S0E2ZDVXeEwwXzAwOHQxWGdNaWtwa2FSYjVHUG5HLTdHeGoxTW9DN2FB" },
  { domain: ".youtube.com", name: "__Secure-3PSIDCC", value: "AKEyXzXQ_HApna54r5KmpR30ixy29nuqpyZs_c3qLtWYvuseu4kfCYwRIL0Y-W-Edg-mx1c8" },
  { domain: ".youtube.com", name: "YSC", value: "gABlll5pXh4" },
  { domain: ".youtube.com", name: "VISITOR_INFO1_LIVE", value: "fFhm90Ik1ec" },
  { domain: ".youtube.com", name: "VISITOR_PRIVACY_METADATA", value: "CgJWThIEGgAgEA%3D%3D" },
  { domain: ".youtube.com", name: "__Secure-YNID", value: "20.YT=RR6bM5mmfaz5_UetmypIB_DGlrhbaaBzysR5Qa-Vay6tlmXugEZRX3hQ7h1ajdJX_oEoNc6x7bzCr_OVJuGoounEZ-l5Ewzw455Moe3o8CaG9_SD6aF06IkBQRvzGfkT9bxvFRmbf4tJreyNx_I9eR3ApOrH8KOOeHFFAp6KB3xcMUNIHyAQ1uaeXlJqm8OtGLErW3jWC0jTZHZduHa6zFRRIE3-rPd0T9PXNQoey5xjg3dO1HopTqOqv-Vf9Ts9dOsXoOIvpxUEROWZqQFPPbTWTUfy3YEFWG7ZqWlWD9pdSyzss-IjzAXcNsQc56p9eFu3KzY-OVVqEy_bR3Tptg" },
  { domain: ".youtube.com", name: "__Secure-ROLLOUT_TOKEN", value: "COib5-e20qia6AEQ77bTzr6HlgMYmvTlzr6HlgM%3D" }
];

// 2. Khởi tạo Agent với Cookies
const agent = ytdl.createAgent(ytCookies);

// 3. Mở hoàn toàn CORS cho tất cả mọi nguồn (Mục đích testing)
app.use(cors());
app.use(express.json());

/**
 * Endpoint 1: Lấy thông tin video & Direct Stream Link
 * GET /api/info?url=https://www.youtube.com/watch?v=...
 */
app.get('/api/info', async (req, res) => {
    try {
        const videoUrl = req.query.url;

        if (!videoUrl || !ytdl.validateURL(videoUrl)) {
            return res.status(400).json({ status: false, message: 'URL YouTube không hợp lệ' });
        }

        // Truyền Agent chứa cookie xác thực vào ytdl
        const info = await ytdl.getInfo(videoUrl, { agent });

        const combinedFormat = ytdl.chooseFormat(info.formats, { quality: 'highestvideo', filter: 'audioandvideo' });
        const audioFormat = ytdl.chooseFormat(info.formats, { filter: 'audioonly' });

        return res.json({
            status: true,
            data: {
                title: info.videoDetails.title,
                duration: info.videoDetails.lengthSeconds,
                author: info.videoDetails.author.name,
                thumbnail: info.videoDetails.thumbnails.pop()?.url,
                stream_url: combinedFormat ? combinedFormat.url : null,
                audio_url: audioFormat ? audioFormat.url : null
            }
        });

    } catch (error) {
        return res.status(500).json({ status: false, error: error.message });
    }
});

/**
 * Endpoint 2: Pipe trực tiếp luồng Âm thanh
 * GET /api/stream-audio?url=https://www.youtube.com/watch?v=...
 */
app.get('/api/stream-audio', async (req, res) => {
    try {
        const videoUrl = req.query.url;

        if (!videoUrl || !ytdl.validateURL(videoUrl)) {
            return res.status(400).json({ status: false, message: 'URL YouTube không hợp lệ' });
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Accept-Ranges', 'bytes');

        ytdl(videoUrl, {
            agent,
            filter: 'audioonly',
            highWaterMark: 1 << 25
        }).pipe(res);

    } catch (error) {
        return res.status(500).json({ status: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;