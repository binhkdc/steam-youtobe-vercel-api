const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Route kiểm tra
app.get('/', (req, res) => {
    res.json({ message: 'API đang hoạt động ổn định!' });
});

// Route xử lý công việc chính
app.get('/api/example', (req, res) => {
    res.json({ status: 'success', data: 'Dữ liệu từ Express API' });
});

// Chạy ở máy Local (Port 3000)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
});

module.exports = app;